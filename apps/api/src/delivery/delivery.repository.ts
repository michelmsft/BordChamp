import { TableClient, TableTransaction, type TableEntity } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import type { LotQuantity } from "../inventory/inventory.repository.js";
import { createTableClient, hasTableStorageConfiguration } from "../storage/table-client.js";

export const DELIVERY_REPOSITORY = Symbol("DELIVERY_REPOSITORY");
export type DeliveryStatus = "assigned" | "pickedUp" | "inTransit" | "arrived" | "podSubmitted" | "accepted" | "partiallyAccepted" | "rejected";
export interface ConditionEvidence {
  readonly temperatureMilliC?: number;
  readonly oxygenMilliPercent?: number;
  readonly location?: string;
  readonly notes?: string;
}
export interface Delivery {
  readonly id: string; readonly tradeId: string; readonly rfqId: string;
  readonly settlementId: string; readonly lotId: string;
  readonly sellerOrganizationId: string; readonly buyerOrganizationId: string;
  readonly logisticsOrganizationId: string; readonly assignedLogisticsUserId: string;
  readonly quantity: LotQuantity; readonly status: DeliveryStatus;
  readonly podRecipientName?: string; readonly podEvidenceReference?: string;
  readonly acceptedQuantity?: LotQuantity; readonly rejectedQuantity?: LotQuantity;
  readonly rejectionReason?: string; readonly settlementAction?: "release" | "refund" | "hold";
  readonly createdAt: string; readonly updatedAt: string; readonly etag: string;
}
export class DeliveryConflictError extends Error {}
export interface DeliveryRepository {
  create(value: Omit<Delivery, "etag">, actorUserId: string): Promise<Delivery>;
  get(id: string): Promise<Delivery | undefined>;
  milestone(id: string, nextStatus: "pickedUp" | "inTransit" | "arrived", evidence: ConditionEvidence,
    etag: string, actorUserId: string): Promise<Delivery>;
  submitPod(id: string, recipientName: string, evidenceReference: string, evidence: ConditionEvidence,
    etag: string, actorUserId: string): Promise<Delivery>;
  decide(id: string, status: "accepted" | "partiallyAccepted" | "rejected",
    acceptedQuantity: LotQuantity, rejectedQuantity: LotQuantity, rejectionReason: string | undefined,
    settlementAction: "release" | "refund" | "hold", etag: string, actorUserId: string): Promise<Delivery>;
}
interface DeliveryEntity extends TableEntity {
  tradeId: string; rfqId: string; settlementId: string; lotId: string;
  sellerOrganizationId: string; buyerOrganizationId: string;
  logisticsOrganizationId: string; assignedLogisticsUserId: string;
  quantityJson: string; status: DeliveryStatus; podRecipientName?: string;
  podEvidenceReference?: string; acceptedQuantityJson?: string; rejectedQuantityJson?: string;
  rejectionReason?: string; settlementAction?: "release" | "refund" | "hold";
  createdAt: string; updatedAt: string;
}
function profile(d: Omit<Delivery, "etag">): DeliveryEntity {
  return { partitionKey: d.id, rowKey: "PROFILE", tradeId: d.tradeId, rfqId: d.rfqId,
    settlementId: d.settlementId, lotId: d.lotId, sellerOrganizationId: d.sellerOrganizationId,
    buyerOrganizationId: d.buyerOrganizationId, logisticsOrganizationId: d.logisticsOrganizationId,
    assignedLogisticsUserId: d.assignedLogisticsUserId, quantityJson: JSON.stringify(d.quantity), status: d.status,
    ...(d.podRecipientName === undefined ? {} : { podRecipientName: d.podRecipientName }),
    ...(d.podEvidenceReference === undefined ? {} : { podEvidenceReference: d.podEvidenceReference }),
    ...(d.acceptedQuantity === undefined ? {} : { acceptedQuantityJson: JSON.stringify(d.acceptedQuantity) }),
    ...(d.rejectedQuantity === undefined ? {} : { rejectedQuantityJson: JSON.stringify(d.rejectedQuantity) }),
    ...(d.rejectionReason === undefined ? {} : { rejectionReason: d.rejectionReason }),
    ...(d.settlementAction === undefined ? {} : { settlementAction: d.settlementAction }),
    createdAt: d.createdAt, updatedAt: d.updatedAt };
}
function toDelivery(e: DeliveryEntity & { etag?: string }): Delivery {
  return { id: e.partitionKey, tradeId: e.tradeId, rfqId: e.rfqId, settlementId: e.settlementId,
    lotId: e.lotId, sellerOrganizationId: e.sellerOrganizationId,
    buyerOrganizationId: e.buyerOrganizationId, logisticsOrganizationId: e.logisticsOrganizationId,
    assignedLogisticsUserId: e.assignedLogisticsUserId,
    quantity: JSON.parse(e.quantityJson) as LotQuantity, status: e.status,
    ...(e.podRecipientName === undefined ? {} : { podRecipientName: e.podRecipientName }),
    ...(e.podEvidenceReference === undefined ? {} : { podEvidenceReference: e.podEvidenceReference }),
    ...(e.acceptedQuantityJson === undefined ? {} : { acceptedQuantity: JSON.parse(e.acceptedQuantityJson) as LotQuantity }),
    ...(e.rejectedQuantityJson === undefined ? {} : { rejectedQuantity: JSON.parse(e.rejectedQuantityJson) as LotQuantity }),
    ...(e.rejectionReason === undefined ? {} : { rejectionReason: e.rejectionReason }),
    ...(e.settlementAction === undefined ? {} : { settlementAction: e.settlementAction }),
    createdAt: e.createdAt, updatedAt: e.updatedAt, etag: e.etag ?? "" };
}
function event(id: string, type: string, actor: string, at: string, details: string, evidence?: ConditionEvidence): TableEntity {
  return { partitionKey: id, rowKey: `EVENT:${at}:${randomUUID()}`, eventType: type,
    actorUserId: actor, occurredAt: at, details,
    ...(evidence === undefined ? {} : { evidenceJson: JSON.stringify(evidence) }) };
}
abstract class BaseDeliveryRepository implements DeliveryRepository {
  abstract create(value: Omit<Delivery, "etag">, actor: string): Promise<Delivery>;
  abstract get(id: string): Promise<Delivery | undefined>;
  abstract change(id: string, etag: string, actor: string, type: string, details: string,
    apply: (delivery: Delivery, now: string) => Delivery, evidence?: ConditionEvidence): Promise<Delivery>;
  milestone(id: string, nextStatus: "pickedUp" | "inTransit" | "arrived", evidence: ConditionEvidence, etag: string, actor: string) {
    return this.change(id, etag, actor, `delivery.${nextStatus}`, nextStatus,
      (d) => ({ ...d, status: nextStatus }), evidence); }
  submitPod(id: string, recipientName: string, evidenceReference: string, evidence: ConditionEvidence, etag: string, actor: string) {
    return this.change(id, etag, actor, "delivery.podSubmitted", evidenceReference,
      (d) => ({ ...d, status: "podSubmitted", podRecipientName: recipientName, podEvidenceReference: evidenceReference }), evidence); }
  decide(id: string, status: "accepted" | "partiallyAccepted" | "rejected",
    acceptedQuantity: LotQuantity, rejectedQuantity: LotQuantity, rejectionReason: string | undefined,
    settlementAction: "release" | "refund" | "hold", etag: string, actor: string) {
    return this.change(id, etag, actor, `delivery.${status}`, rejectionReason ?? status,
      (d) => ({ ...d, status, acceptedQuantity, rejectedQuantity,
        ...(rejectionReason === undefined ? {} : { rejectionReason }), settlementAction })); }
}
export class InMemoryDeliveryRepository extends BaseDeliveryRepository {
  private values = new Map<string, Delivery>(); private version = 0;
  async create(value: Omit<Delivery, "etag">) { const existing = this.values.get(value.id); if (existing) return existing;
    const saved = { ...value, etag: this.next() }; this.values.set(value.id, saved); return saved; }
  async get(id: string) { return this.values.get(id); }
  async change(id: string, etag: string, _actor: string, _type: string, _details: string,
    apply: (delivery: Delivery, now: string) => Delivery) { const current = this.values.get(id);
    if (!current || current.etag !== etag) throw new DeliveryConflictError(id); const now = new Date().toISOString();
    const next = { ...apply(current, now), updatedAt: now, etag: this.next() }; this.values.set(id, next); return next; }
  private next() { this.version += 1; return `W/\"${this.version}\"`; }
}
export class AzureTableDeliveryRepository extends BaseDeliveryRepository {
  constructor(private table: TableClient) { super(); }
  async create(value: Omit<Delivery, "etag">, actor: string) { const existing = await this.get(value.id); if (existing) return existing;
    const tx = new TableTransaction(); tx.createEntity(profile(value)); tx.createEntity(event(value.id, "delivery.created", actor, value.createdAt, value.tradeId));
    await this.submit(tx); return this.require(value.id); }
  async get(id: string) { try { return toDelivery(await this.table.getEntity<DeliveryEntity>(id, "PROFILE")); }
    catch (e) { if (code(e, 404)) return undefined; throw e; } }
  async change(id: string, etag: string, actor: string, type: string, details: string,
    apply: (delivery: Delivery, now: string) => Delivery, evidence?: ConditionEvidence) {
    const current = await this.require(id); const now = new Date().toISOString(); const next = { ...apply(current, now), updatedAt: now };
    const tx = new TableTransaction(); tx.updateEntity(profile(next), "Replace", { etag });
    tx.createEntity(event(id, type, actor, now, details, evidence)); await this.submit(tx); return this.require(id); }
  private async require(id: string) { const value = await this.get(id); if (!value) throw new Error("Delivery not found"); return value; }
  private async submit(tx: TableTransaction) { try { await this.table.submitTransaction(tx.actions); }
    catch (e) { if (code(e, 409) || code(e, 412)) throw new DeliveryConflictError("Delivery conflict"); throw e; } }
}
function code(e: unknown, value: number) { return typeof e === "object" && e !== null && "statusCode" in e && e.statusCode === value; }
export function createDeliveryRepository(): DeliveryRepository {
  if (!hasTableStorageConfiguration()) { if (process.env.NODE_ENV === "production") throw new Error("Azure Table Storage configuration is required in production"); return new InMemoryDeliveryRepository(); }
  return new AzureTableDeliveryRepository(createTableClient(process.env.AZURE_STORAGE_DELIVERIES_TABLE ?? "Deliveries"));
}