import { authorize } from "@bordchamp/authz";
import type { ActorContext, EntityStatus } from "@bordchamp/domain";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import {
  SETTLEMENT_REPOSITORY,
  SettlementConflictError,
  type ProviderEvent,
  type Settlement,
  type SettlementRepository,
} from "./settlement.repository.js";
import {
  TRADING_REPOSITORY,
  type TradingRepository,
} from "../trading/trading.repository.js";
import { IntegrationsService } from "../integrations/integrations.service.js";

@Injectable()
export class SettlementService {
  constructor(
    @Inject(SETTLEMENT_REPOSITORY)
    private readonly settlements: SettlementRepository,
    @Inject(TRADING_REPOSITORY)
    private readonly trading: TradingRepository,
    @Inject(IntegrationsService)
    private readonly integrations: IntegrationsService,
  ) {}

  async initialize(
    actor: ActorContext,
    rfqId: string,
    tradeId: string,
  ): Promise<Settlement> {
    const trade = await this.trading.getTrade(rfqId, tradeId);
    if (trade === undefined) {
      throw new NotFoundException("Trade confirmation not found");
    }
    this.assert(
      "settlement.initialize",
      actor,
      "active",
      trade.buyerOrganizationId,
    );
    if (trade.totalAmountMinor !== trade.grossAmountMinor + trade.feeAmountMinor) {
      throw new ConflictException("Trade amount snapshot is inconsistent");
    }
    const id = `SET-${trade.id}`;
    const existing = await this.settlements.get(id);
    if (existing !== undefined) return existing;
    const now = new Date().toISOString();
    return this.mapConflict(() =>
      this.settlements.create(
        {
          id,
          tradeId: trade.id,
          rfqId: trade.rfqId,
          sellerOrganizationId: trade.sellerOrganizationId,
          buyerOrganizationId: trade.buyerOrganizationId,
          grossAmountMinor: trade.grossAmountMinor,
          feeAmountMinor: trade.feeAmountMinor,
          totalAmountMinor: trade.totalAmountMinor,
          currencyCode: "XOF",
          status: "awaitingFunding",
          providerReference: `FUND-${id}`,
          reconciliationStatus: "pending",
          createdAt: now,
          updatedAt: now,
        },
        actor.userId,
      ),
    );
  }

  async get(actor: ActorContext, id: string) {
    const settlement = await this.requireSettlement(id);
    const actorOrganizationId = actor.organizationId;
    const resourceOrganizationId =
      actorOrganizationId === settlement.buyerOrganizationId ||
      actorOrganizationId === settlement.sellerOrganizationId
        ? actorOrganizationId
        : settlement.sellerOrganizationId;
    this.assert(
      "settlement.view",
      actor,
      policyStatus(settlement.status),
      resourceOrganizationId,
    );
    return {
      settlement,
      fundingInstruction: {
        provider: "licensed-escrow-partner",
        reference: settlement.providerReference,
        amountMinor: settlement.totalAmountMinor,
        currencyCode: settlement.currencyCode,
      },
      ledger: await this.settlements.listLedger(id),
    };
  }

  async requestAction(
    actor: ActorContext,
    id: string,
    action: "release" | "refund",
    etag: string,
  ): Promise<Settlement> {
    const settlement = await this.requireSettlement(id);
    const targetStatus =
      action === "release"
        ? "releasePending"
        : action === "refund"
          ? "refundPending"
          : "deliveryHold";
    if (settlement.status === targetStatus) {
      return settlement;
    }
    if (settlement.status !== "funded") {
      throw new BadRequestException("Only a funded settlement can be released or refunded");
    }
    this.assert("settlement.manage", actor, "active", settlement.sellerOrganizationId);
    return this.mapConflict(() =>
      this.settlements.requestAction(id, action, etag, actor.userId),
    );
  }

  async requestFromDelivery(
    id: string,
    action: "release" | "refund" | "hold",
    etag: string,
    deliveryId: string,
  ): Promise<Settlement> {
    const settlement = await this.requireSettlement(id);
    const targetStatus =
      action === "release"
        ? "releasePending"
        : action === "refund"
          ? "refundPending"
          : "deliveryHold";
    if (settlement.status === targetStatus) {
      return settlement;
    }
    if (settlement.status !== "funded") {
      throw new BadRequestException(
        "Delivery outcome requires a funded settlement",
      );
    }
    return this.mapConflict(() =>
      this.settlements.requestAction(
        id,
        action,
        etag,
        `delivery:${deliveryId}`,
      ),
    );
  }

  async resolveDeliveryHold(
    id: string,
    action: "release" | "refund",
    etag: string,
    disputeId: string,
  ): Promise<Settlement> {
    const settlement = await this.requireSettlement(id);
    const targetStatus =
      action === "release" ? "releasePending" : "refundPending";
    if (settlement.status === targetStatus) {
      return settlement;
    }
    if (settlement.status !== "deliveryHold") {
      throw new BadRequestException(
        "Only a delivery-held settlement can be resolved by dispute",
      );
    }
    return this.mapConflict(() =>
      this.settlements.requestAction(
        id,
        action,
        etag,
        `dispute:${disputeId}`,
      ),
    );
  }

  async applyProviderEvent(event: ProviderEvent, signature: string): Promise<Settlement> {
    verifySignature(event, signature);
    const settlement = await this.mapConflict(() =>
      this.settlements.applyProviderEvent(event),
    );
    await this.integrations.publishBestEffort(
      "private.settlement.updated",
      [settlement.sellerOrganizationId, settlement.buyerOrganizationId],
      settlement.id,
      {
        settlementId: settlement.id,
        tradeId: settlement.tradeId,
        status: settlement.status,
        reconciliationStatus: settlement.reconciliationStatus,
        totalAmountMinor: settlement.totalAmountMinor,
        currencyCode: settlement.currencyCode,
      },
    );
    return settlement;
  }

  private async requireSettlement(id: string): Promise<Settlement> {
    const settlement = await this.settlements.get(id);
    if (settlement === undefined) throw new NotFoundException("Settlement not found");
    return settlement;
  }

  private assert(
    action: "settlement.initialize" | "settlement.view" | "settlement.manage",
    actor: ActorContext,
    status: EntityStatus,
    organizationId: string,
  ) {
    const decision = authorize({
      action,
      actor,
      entityStatus: status,
      resourceOrganizationId: organizationId,
    });
    if (!decision.allowed) throw new ForbiddenException(decision.reason);
  }

  private async mapConflict<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof SettlementConflictError) {
        throw new ConflictException(error.message || "Settlement state conflict");
      }
      throw error;
    }
  }
}

export function providerEventPayload(event: ProviderEvent): string {
  return [
    event.eventId,
    event.settlementId,
    event.type,
    event.providerReference,
    event.occurredAt,
  ].join("|");
}

function verifySignature(event: ProviderEvent, signature: string): void {
  const secret = process.env.ESCROW_WEBHOOK_SECRET;
  if (secret === undefined || secret.length < 16) {
    throw new Error("ESCROW_WEBHOOK_SECRET must contain at least 16 characters");
  }
  const expected = createHmac("sha256", secret)
    .update(providerEventPayload(event))
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "hex");
  } catch {
    throw new UnauthorizedException("Invalid provider signature");
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new UnauthorizedException("Invalid provider signature");
  }
}

function policyStatus(status: Settlement["status"]): EntityStatus {
  return status === "released" || status === "refunded" ? "inactive" : "active";
}