import { authorize } from "@bordchamp/authz";
import type { ActorContext, EntityStatus } from "@bordchamp/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  INVENTORY_REPOSITORY,
  InventoryConflictError,
  type InventoryRepository,
} from "../inventory/inventory.repository.js";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organizations/organization.repository.js";
import {
  TRADING_REPOSITORY,
  TradingConflictError,
  type Quote,
  type SellRfq,
  type TradeConfirmation,
  type TradingRepository,
} from "./trading.repository.js";
import {
  WAREHOUSE_RECEIPT_REPOSITORY,
  type WarehouseReceiptRepository,
} from "../warehousing/warehouse-receipt.repository.js";
import {
  COMPLIANCE_REPOSITORY,
  type ComplianceRepository,
} from "../compliance/compliance.repository.js";
import { RiskService } from "../risk/risk.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";

const FEE_BASIS_POINTS = 100;

@Injectable()
export class TradingService {
  constructor(
    @Inject(TRADING_REPOSITORY) private readonly trading: TradingRepository,
    @Inject(INVENTORY_REPOSITORY) private readonly inventory: InventoryRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(WAREHOUSE_RECEIPT_REPOSITORY)
    private readonly warehouseReceipts: WarehouseReceiptRepository,
    @Inject(COMPLIANCE_REPOSITORY)
    private readonly compliance: ComplianceRepository,
    @Inject(RiskService)
    private readonly risk: RiskService,
    @Inject(IntegrationsService)
    private readonly integrations: IntegrationsService,
  ) {}

  async createSellRfq(
    actor: ActorContext,
    lotId: string,
    invitedBuyerOrganizationIds: readonly string[],
    expiresAt: string,
  ): Promise<SellRfq> {
    const lot = await this.inventory.get(lotId);
    if (lot === undefined) {
      throw new BadRequestException("Lot is not available for sale");
    }
    const id = `SRFQ-${lot.id}`;
    if (
      lot.status !== "available" &&
      !(lot.status === "reserved" && lot.reservedRfqId === id)
    ) {
      throw new BadRequestException("Lot is not available for sale");
    }
    const receipt = await this.warehouseReceipts.get(`WR-${lot.id}`);
    if (receipt?.pledgeStatus === "pledged") {
      throw new BadRequestException("Pledged inventory cannot be offered for sale");
    }
    const sellerOrganizationId =
      receipt?.ownerOrganizationId ?? lot.ownerOrganizationId;
    await this.assertMovementAllowed(lot);
    this.assert("trading.rfq.create", actor, "active", sellerOrganizationId);
    if (new Date(expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException("RFQ expiry must be in the future");
    }
    const uniqueBuyers = [...new Set(invitedBuyerOrganizationIds)];
    if (uniqueBuyers.length === 0) {
      throw new BadRequestException("At least one invited buyer is required");
    }
    for (const buyerId of uniqueBuyers) {
      const buyer = await this.organizations.get(buyerId);
      if (buyer === undefined || buyer.status !== "active" || !["buyer", "trader"].includes(buyer.type)) {
        throw new BadRequestException("Invited buyer is not an active buyer or trader");
      }
    }

    const now = new Date().toISOString();
    const existing = await this.trading.get(id);
    if (existing !== undefined) {
      if (existing.status === "open" && lot.status === "reserved" && lot.reservedRfqId === id) {
        return existing;
      }
      throw new ConflictException("An RFQ lifecycle already exists for this lot");
    }
    await this.mapInventoryConflict(() =>
      this.inventory.reserveForSale(lot.id, id, lot.etag, actor.userId),
    );
    return this.mapTradingConflict(() =>
      this.trading.create(
        {
          id,
          lotId: lot.id,
          sellerOrganizationId,
          commodityCode: lot.commodityCode,
          quantity: lot.quantity,
          invitedBuyerOrganizationIds: uniqueBuyers,
          currencyCode: "XOF",
          expiresAt,
          status: "open",
          createdAt: now,
          updatedAt: now,
        },
        actor.userId,
      ),
    );
  }

  async get(actor: ActorContext, id: string): Promise<{ rfq: SellRfq; quotes: readonly Quote[]; trade?: TradeConfirmation }> {
    const rfq = await this.requireRfq(id);
    this.assertParticipantView(actor, rfq);
    const visibleQuotes = await this.trading.listQuotes(id);
    const actorOrganizationId = actor.organizationId;
    const quotes =
      actorOrganizationId !== undefined &&
      rfq.invitedBuyerOrganizationIds.includes(actorOrganizationId)
        ? visibleQuotes.filter(
            (quote) => quote.buyerOrganizationId === actorOrganizationId,
          )
        : visibleQuotes;
    const trade = rfq.tradeId === undefined ? undefined : await this.trading.getTrade(id, rfq.tradeId);
    return { rfq, quotes, ...(trade === undefined ? {} : { trade }) };
  }

  async quote(actor: ActorContext, id: string, unitPriceMinor: number): Promise<Quote> {
    const rfq = await this.requireOpenRfq(id);
    const buyerOrganizationId = actor.organizationId;
    if (buyerOrganizationId === undefined || !rfq.invitedBuyerOrganizationIds.includes(buyerOrganizationId)) {
      throw new ForbiddenException("Buyer is not invited to this RFQ");
    }
    this.assert("trading.rfq.quote", actor, "active", buyerOrganizationId);
    await this.requireActiveOrganization(buyerOrganizationId);
    if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) {
      throw new BadRequestException("unitPriceMinor must be a positive safe integer");
    }
    const grossAmountMinor = scaledAmount(unitPriceMinor, rfq.quantity.value, rfq.quantity.scale);
    const feeAmountMinor = Math.ceil((grossAmountMinor * FEE_BASIS_POINTS) / 10_000);
    const quote: Quote = {
      id: `Q-${buyerOrganizationId}`,
      rfqId: id,
      buyerOrganizationId,
      unitPriceMinor,
      grossAmountMinor,
      feeAmountMinor,
      totalAmountMinor: safeAdd(grossAmountMinor, feeAmountMinor),
      currencyCode: "XOF",
      createdAt: new Date().toISOString(),
    };
    return this.mapTradingConflict(() => this.trading.createQuote(quote, actor.userId));
  }

  async cancel(actor: ActorContext, id: string, reason: string, etag: string): Promise<SellRfq> {
    const rfq = await this.requireRfq(id);
    if (rfq.status !== "open") {
      throw new BadRequestException("RFQ is not open");
    }
    this.assert("trading.rfq.cancel", actor, "active", rfq.sellerOrganizationId);
    const cancelled = await this.mapTradingConflict(() => this.trading.cancel(id, reason, etag, actor.userId));
    const lot = await this.inventory.get(rfq.lotId);
    if (lot?.status === "reserved" && lot.reservedRfqId === id) {
      await this.mapInventoryConflict(() => this.inventory.releaseSaleReservation(lot.id, id, lot.etag, actor.userId));
    }
    return cancelled;
  }

  async accept(actor: ActorContext, id: string, quoteId: string, etag: string): Promise<{ rfq: SellRfq; trade: TradeConfirmation }> {
    const current = await this.requireRfq(id);
    if (current.status === "accepted" && current.tradeId !== undefined) {
      const existingTrade = await this.trading.getTrade(id, current.tradeId);
      if (existingTrade === undefined) {
        throw new ConflictException("Accepted RFQ is missing its trade confirmation");
      }
      return { rfq: current, trade: existingTrade };
    }
    const rfq = await this.requireOpenRfq(id);
    this.assert("trading.rfq.accept", actor, "active", rfq.sellerOrganizationId);
    const quote = await this.trading.getQuote(id, quoteId);
    if (quote === undefined) throw new NotFoundException("Quote not found");
    await this.requireActiveOrganization(quote.buyerOrganizationId);
    const tradeId = `TR-${id}`;
    const executedAt = new Date().toISOString();
    const trade: TradeConfirmation = {
      id: tradeId, rfqId: id, quoteId: quote.id, lotId: rfq.lotId,
      sellerOrganizationId: rfq.sellerOrganizationId,
      buyerOrganizationId: quote.buyerOrganizationId,
      commodityCode: rfq.commodityCode, quantity: rfq.quantity,
      unitPriceMinor: quote.unitPriceMinor, grossAmountMinor: quote.grossAmountMinor,
      feeAmountMinor: quote.feeAmountMinor, totalAmountMinor: quote.totalAmountMinor,
      currencyCode: "XOF", executedAt,
    };
    await this.risk.reserveTradeExposure(
      trade.sellerOrganizationId,
      trade.buyerOrganizationId,
      trade.id,
      trade.totalAmountMinor,
    );
    const lot = await this.inventory.get(rfq.lotId);
    if (lot === undefined) throw new NotFoundException("Lot not found");
    await this.assertMovementAllowed(lot);
    await this.mapInventoryConflict(() => this.inventory.markSold(lot.id, id, tradeId, lot.etag, actor.userId));
    const accepted = await this.mapTradingConflict(() => this.trading.accept(id, quote, trade, etag, actor.userId));
    await this.integrations.publishBestEffort(
      "private.trade.executed",
      [trade.sellerOrganizationId, trade.buyerOrganizationId],
      trade.id,
      {
        tradeId: trade.id,
        rfqId: trade.rfqId,
        commodityCode: trade.commodityCode,
        grossAmountMinor: trade.grossAmountMinor,
        feeAmountMinor: trade.feeAmountMinor,
        currencyCode: trade.currencyCode,
      },
    );
    return { rfq: accepted, trade };
  }

  private async requireRfq(id: string) { const rfq = await this.trading.get(id); if (!rfq) throw new NotFoundException("RFQ not found"); return rfq; }
  private async requireOpenRfq(id: string) { const rfq = await this.requireRfq(id);
    if (rfq.status !== "open") throw new BadRequestException("RFQ is not open");
    if (new Date(rfq.expiresAt).getTime() <= Date.now()) throw new BadRequestException("RFQ has expired"); return rfq; }
  private assertParticipantView(actor: ActorContext, rfq: SellRfq) { const org = actor.organizationId;
    const resource = org !== undefined && rfq.invitedBuyerOrganizationIds.includes(org) ? org : rfq.sellerOrganizationId;
    this.assert("trading.rfq.view", actor, rfq.status === "open" ? "active" : "inactive", resource); }
  private assert(action: "trading.rfq.create" | "trading.rfq.view" | "trading.rfq.quote" | "trading.rfq.accept" | "trading.rfq.cancel", actor: ActorContext, status: EntityStatus, org: string) {
    const d = authorize({ action, actor, entityStatus: status, resourceOrganizationId: org }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  private async requireActiveOrganization(id: string) { const o = await this.organizations.get(id); if (!o || o.status !== "active") throw new BadRequestException("Organization is not active"); }
  private async assertMovementAllowed(lot: Awaited<ReturnType<InventoryRepository["get"]>>) {
    if (lot === undefined || lot.originRegionCode === undefined) return;
    const now = Date.now();
    const restrictions = await this.compliance.listMovementRestrictions(
      lot.originRegionCode,
    );
    const blocked = restrictions.some(
      (restriction) =>
        restriction.status === "active" &&
        new Date(restriction.effectiveFrom).getTime() <= now &&
        (restriction.effectiveUntil === undefined ||
          new Date(restriction.effectiveUntil).getTime() > now) &&
        (restriction.commodityCode === undefined ||
          restriction.commodityCode === lot.commodityCode),
    );
    if (blocked) {
      throw new BadRequestException(
        "Lot is subject to an active geographic movement restriction",
      );
    }
  }
  private async mapTradingConflict<T>(op: () => Promise<T>) { try { return await op(); } catch (e) { if (e instanceof TradingConflictError) throw new ConflictException("Trading state changed; refresh and retry"); throw e; } }
  private async mapInventoryConflict<T>(op: () => Promise<T>) { try { return await op(); } catch (e) { if (e instanceof InventoryConflictError) throw new ConflictException("Lot is already reserved or sold"); throw e; } }
}

function scaledAmount(price: number, value: number, scale: number): number {
  const product = price * value; if (!Number.isSafeInteger(product)) throw new BadRequestException("Quote amount is too large");
  return Math.ceil(product / 10 ** scale);
}
function safeAdd(a: number, b: number) { const result = a + b; if (!Number.isSafeInteger(result)) throw new BadRequestException("Quote amount is too large"); return result; }