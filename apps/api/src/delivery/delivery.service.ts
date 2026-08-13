import { authorize } from "@bordchamp/authz";
import type { ActorContext, EntityStatus } from "@bordchamp/domain";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from "../organizations/organization.repository.js";
import { SETTLEMENT_REPOSITORY, type SettlementRepository } from "../settlement/settlement.repository.js";
import { SettlementService } from "../settlement/settlement.service.js";
import { TRADING_REPOSITORY, type TradingRepository } from "../trading/trading.repository.js";
import { DELIVERY_REPOSITORY, DeliveryConflictError, type ConditionEvidence, type Delivery, type DeliveryRepository } from "./delivery.repository.js";
import type { LotQuantity } from "../inventory/inventory.repository.js";
import { RiskService } from "../risk/risk.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";

@Injectable()
export class DeliveryService {
  constructor(@Inject(DELIVERY_REPOSITORY) private deliveries: DeliveryRepository,
    @Inject(TRADING_REPOSITORY) private trading: TradingRepository,
    @Inject(SETTLEMENT_REPOSITORY) private settlements: SettlementRepository,
    @Inject(SettlementService) private settlementService: SettlementService,
    @Inject(ORGANIZATION_REPOSITORY) private organizations: OrganizationRepository,
    @Inject(RiskService) private risk: RiskService,
    @Inject(IntegrationsService) private integrations: IntegrationsService) {}
  async create(actor: ActorContext, rfqId: string, tradeId: string, logisticsOrganizationId: string, assignedLogisticsUserId: string) {
    const trade = await this.trading.getTrade(rfqId, tradeId); if (!trade) throw new NotFoundException("Trade not found");
    const resource = actor.organizationId === trade.buyerOrganizationId ? trade.buyerOrganizationId : trade.sellerOrganizationId;
    this.assert("delivery.create", actor, "active", resource);
    const logistics = await this.organizations.get(logisticsOrganizationId);
    if (!logistics || logistics.type !== "logisticsProvider" || logistics.status !== "active") throw new BadRequestException("Logistics provider is not active");
    const settlementId = `SET-${trade.id}`; const settlement = await this.settlements.get(settlementId);
    if (!settlement || settlement.status !== "funded") throw new BadRequestException("Delivery requires a funded settlement");
    const id = `DEL-${trade.id}`; const now = new Date().toISOString();
    return this.deliveries.create({ id, tradeId, rfqId, settlementId, lotId: trade.lotId,
      sellerOrganizationId: trade.sellerOrganizationId, buyerOrganizationId: trade.buyerOrganizationId,
      logisticsOrganizationId, assignedLogisticsUserId, quantity: trade.quantity,
      status: "assigned", createdAt: now, updatedAt: now }, actor.userId);
  }
  async get(actor: ActorContext, id: string) { const d = await this.require(id); const scoped = assigned(actor, d);
    const org = actor.organizationId === d.buyerOrganizationId ? d.buyerOrganizationId : d.sellerOrganizationId;
    this.assert("delivery.view", scoped, terminal(d.status) ? "inactive" : "active", org, d.id); return d; }
  async milestone(actor: ActorContext, id: string, next: "pickedUp" | "inTransit" | "arrived", evidence: ConditionEvidence, etag: string) {
    const d = await this.require(id); const expected = nextMilestone(d.status);
    if (expected !== next) throw new BadRequestException("Delivery milestone is out of sequence");
    const scoped = assigned(actor, d); this.assert("delivery.update", scoped, "active", d.logisticsOrganizationId, d.id);
    const updated=await this.map(() => this.deliveries.milestone(id, next, evidence, etag, actor.userId));
    await this.risk.evaluateCondition(d.logisticsOrganizationId,d.id,evidence.temperatureMilliC,evidence.oxygenMilliPercent);
    await this.publish(updated);return updated; }
  async submitPod(actor: ActorContext, id: string, recipient: string, evidenceReference: string, evidence: ConditionEvidence, etag: string) {
    const d = await this.require(id); if (d.status !== "arrived") throw new BadRequestException("POD requires arrival");
    const scoped = assigned(actor, d); this.assert("delivery.update", scoped, "active", d.logisticsOrganizationId, d.id);
    const updated=await this.map(() => this.deliveries.submitPod(id, recipient, evidenceReference, evidence, etag, actor.userId));await this.publish(updated);return updated; }
  async decide(actor: ActorContext, id: string, accepted: LotQuantity, rejected: LotQuantity, reason: string | undefined, etag: string) {
    const d = await this.require(id); if (d.status !== "podSubmitted") throw new BadRequestException("Receipt decision requires POD");
    this.assert("delivery.receive", actor, "active", d.buyerOrganizationId); validateQuantities(d.quantity, accepted, rejected);
    const status = accepted.value === d.quantity.value ? "accepted" : accepted.value === 0 ? "rejected" : "partiallyAccepted";
    if (status !== "accepted" && reason === undefined) throw new BadRequestException("Rejection reason is required");
    const action = status === "accepted" ? "release" : status === "rejected" ? "refund" : "hold";
    const settlement = await this.settlements.get(d.settlementId); if (!settlement) throw new NotFoundException("Settlement not found");
    await this.settlementService.requestFromDelivery(d.settlementId, action, settlement.etag, d.id);
    const decided=await this.map(() => this.deliveries.decide(id, status, accepted, rejected, reason, action, etag, actor.userId));
    await this.risk.releaseTradeExposure(d.sellerOrganizationId,d.buyerOrganizationId,d.tradeId);await this.publish(decided);return decided; }
  private async require(id: string) { const d = await this.deliveries.get(id); if (!d) throw new NotFoundException("Delivery not found"); return d; }
  private assert(action: "delivery.create" | "delivery.view" | "delivery.update" | "delivery.receive", actor: ActorContext, status: EntityStatus, org: string, assignmentId?: string) {
    const result = authorize({ action, actor, entityStatus: status, resourceOrganizationId: org, ...(assignmentId === undefined ? {} : { assignmentId }) });
    if (!result.allowed) throw new ForbiddenException(result.reason); }
  private async map<T>(op: () => Promise<T>) { try { return await op(); } catch (e) { if (e instanceof DeliveryConflictError) throw new ConflictException("Delivery changed; refresh and retry"); throw e; } }
  private publish(d:Delivery){return this.integrations.publishBestEffort("private.delivery.updated",[d.sellerOrganizationId,d.buyerOrganizationId,d.logisticsOrganizationId],d.id,{deliveryId:d.id,tradeId:d.tradeId,status:d.status,...(d.settlementAction===undefined?{}:{settlementAction:d.settlementAction})});}
}
function assigned(actor: ActorContext, d: Delivery): ActorContext { return actor.userId === d.assignedLogisticsUserId ? { ...actor, assignmentIds: [...actor.assignmentIds, d.id] } : actor; }
function terminal(status: Delivery["status"]) { return ["accepted", "partiallyAccepted", "rejected"].includes(status); }
function nextMilestone(status: Delivery["status"]): "pickedUp" | "inTransit" | "arrived" | undefined {
  if (status === "assigned") return "pickedUp";
  if (status === "pickedUp") return "inTransit";
  if (status === "inTransit") return "arrived";
  return undefined;
}
function validateQuantities(total: LotQuantity, accepted: LotQuantity, rejected: LotQuantity) {
  if (accepted.scale !== total.scale || rejected.scale !== total.scale || accepted.unitCode !== total.unitCode || rejected.unitCode !== total.unitCode) throw new BadRequestException("Decision quantities must use the trade unit and scale");
  if (accepted.value < 0 || rejected.value < 0 || accepted.value + rejected.value !== total.value) throw new BadRequestException("Accepted and rejected quantities must equal the trade quantity"); }