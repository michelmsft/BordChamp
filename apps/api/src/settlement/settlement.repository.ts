import { TableClient, TableTransaction, type TableEntity } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { createTableClient, hasTableStorageConfiguration } from "../storage/table-client.js";

export const SETTLEMENT_REPOSITORY = Symbol("SETTLEMENT_REPOSITORY");
export type SettlementStatus = "awaitingFunding" | "funded" | "deliveryHold" | "releasePending" | "refundPending" | "released" | "refunded";
export type ProviderEventType = "FUNDED" | "RELEASED" | "REFUNDED";

export interface Settlement {
  readonly id: string; readonly tradeId: string; readonly rfqId: string;
  readonly sellerOrganizationId: string; readonly buyerOrganizationId: string;
  readonly grossAmountMinor: number; readonly feeAmountMinor: number;
  readonly totalAmountMinor: number; readonly currencyCode: "XOF";
  readonly status: SettlementStatus; readonly providerReference: string;
  readonly reconciliationStatus: "pending" | "matched";
  readonly createdAt: string; readonly updatedAt: string; readonly etag: string;
}
export interface LedgerEntry {
  readonly journalId: string; readonly sequence: number; readonly account: string;
  readonly side: "debit" | "credit"; readonly amountMinor: number;
  readonly currencyCode: "XOF"; readonly occurredAt: string;
}
export interface ProviderEvent {
  readonly eventId: string; readonly settlementId: string; readonly type: ProviderEventType;
  readonly providerReference: string; readonly occurredAt: string;
}
export class SettlementConflictError extends Error {}

export interface SettlementRepository {
  create(settlement: Omit<Settlement, "etag">, actorUserId: string): Promise<Settlement>;
  get(id: string): Promise<Settlement | undefined>;
  listLedger(id: string): Promise<readonly LedgerEntry[]>;
  requestAction(id: string, action: "release" | "refund" | "hold", etag: string, actorUserId: string): Promise<Settlement>;
  applyProviderEvent(event: ProviderEvent): Promise<Settlement>;
}

interface SettlementEntity extends TableEntity {
  tradeId: string; rfqId: string; sellerOrganizationId: string; buyerOrganizationId: string;
  grossAmountMinor: number; feeAmountMinor: number; totalAmountMinor: number;
  currencyCode: "XOF"; status: SettlementStatus; providerReference: string;
  reconciliationStatus: "pending" | "matched"; createdAt: string; updatedAt: string;
}
function profile(s: Omit<Settlement, "etag">): SettlementEntity {
  return { partitionKey: s.id, rowKey: "PROFILE", tradeId: s.tradeId, rfqId: s.rfqId,
    sellerOrganizationId: s.sellerOrganizationId, buyerOrganizationId: s.buyerOrganizationId,
    grossAmountMinor: s.grossAmountMinor, feeAmountMinor: s.feeAmountMinor,
    totalAmountMinor: s.totalAmountMinor, currencyCode: s.currencyCode, status: s.status,
    providerReference: s.providerReference, reconciliationStatus: s.reconciliationStatus,
    createdAt: s.createdAt, updatedAt: s.updatedAt };
}
function toSettlement(e: SettlementEntity & { etag?: string }): Settlement {
  return { id: e.partitionKey, tradeId: e.tradeId, rfqId: e.rfqId,
    sellerOrganizationId: e.sellerOrganizationId, buyerOrganizationId: e.buyerOrganizationId,
    grossAmountMinor: e.grossAmountMinor, feeAmountMinor: e.feeAmountMinor,
    totalAmountMinor: e.totalAmountMinor, currencyCode: e.currencyCode, status: e.status,
    providerReference: e.providerReference, reconciliationStatus: e.reconciliationStatus,
    createdAt: e.createdAt, updatedAt: e.updatedAt, etag: e.etag ?? "" };
}
function posting(settlementId: string, entry: LedgerEntry): TableEntity {
  return { partitionKey: settlementId,
    rowKey: `JOURNAL:${entry.journalId}:${String(entry.sequence).padStart(3, "0")}`,
    ...entry };
}
function toEntry(e: TableEntity & Record<string, unknown>): LedgerEntry {
  return { journalId: e.journalId as string, sequence: e.sequence as number,
    account: e.account as string, side: e.side as "debit" | "credit",
    amountMinor: e.amountMinor as number, currencyCode: "XOF", occurredAt: e.occurredAt as string };
}
function audit(id: string, type: string, at: string, details: string): TableEntity {
  return { partitionKey: id, rowKey: `EVENT:${at}:${randomUUID()}`, eventType: type, occurredAt: at, details };
}
function journal(id: string, at: string, specs: readonly [string, "debit" | "credit", number][]): LedgerEntry[] {
  const entries = specs.map(([account, side, amountMinor], index) => ({ journalId: id,
    sequence: index + 1, account, side, amountMinor, currencyCode: "XOF" as const, occurredAt: at }));
  const debit = entries.filter(e => e.side === "debit").reduce((sum, e) => sum + e.amountMinor, 0);
  const credit = entries.filter(e => e.side === "credit").reduce((sum, e) => sum + e.amountMinor, 0);
  if (!Number.isSafeInteger(debit) || debit !== credit) throw new Error("Unbalanced settlement journal");
  return entries;
}

abstract class BaseSettlementRepository implements SettlementRepository {
  abstract create(s: Omit<Settlement, "etag">, actor: string): Promise<Settlement>;
  abstract get(id: string): Promise<Settlement | undefined>;
  abstract listLedger(id: string): Promise<readonly LedgerEntry[]>;
  abstract transact(id: string, etag: string, next: Omit<Settlement, "etag">,
    entries: readonly LedgerEntry[], eventType: string, details: string,
    callback?: ProviderEvent): Promise<Settlement>;
  async requestAction(id: string, action: "release" | "refund" | "hold", etag: string): Promise<Settlement> {
    const current = await this.require(id); const now = new Date().toISOString();
    const status = action === "release" ? "releasePending" : action === "refund" ? "refundPending" : "deliveryHold";
    return this.transact(id, etag, { ...current, status, updatedAt: now }, [],
      `settlement.${action}Requested`, action);
  }
  async applyProviderEvent(event: ProviderEvent): Promise<Settlement> {
    const current = await this.require(event.settlementId);
    if (current.providerReference !== event.providerReference) throw new SettlementConflictError("Provider reference mismatch");
    const existing = await this.callbackExists(event.settlementId, event.eventId);
    if (existing) return current;
    let status: SettlementStatus; let specs: [string, "debit" | "credit", number][];
    if (event.type === "FUNDED" && current.status === "awaitingFunding") {
      status = "funded"; specs = [["ESCROW_CASH", "debit", current.totalAmountMinor],
        [`BUYER_RECEIVABLE:${current.buyerOrganizationId}`, "credit", current.totalAmountMinor]];
    } else if (event.type === "RELEASED" && current.status === "releasePending") {
      status = "released"; specs = [[`SELLER_PAYABLE:${current.sellerOrganizationId}`, "debit", current.grossAmountMinor],
        ["PLATFORM_CASH", "debit", current.feeAmountMinor],
        ["ESCROW_CASH", "credit", current.totalAmountMinor]];
    } else if (event.type === "REFUNDED" && current.status === "refundPending") {
      status = "refunded"; specs = [[`SELLER_PAYABLE:${current.sellerOrganizationId}`, "debit", current.grossAmountMinor],
        ["PLATFORM_FEE_REVENUE", "debit", current.feeAmountMinor],
        [`BUYER_REFUND_PAYABLE:${current.buyerOrganizationId}`, "credit", current.totalAmountMinor],
        [`BUYER_REFUND_PAYABLE:${current.buyerOrganizationId}`, "debit", current.totalAmountMinor],
        ["ESCROW_CASH", "credit", current.totalAmountMinor]];
    } else throw new SettlementConflictError("Provider event is invalid for settlement state");
    const entries = journal(`${event.type}-${event.eventId}`, event.occurredAt, specs);
    return this.transact(current.id, current.etag,
      { ...current, status, reconciliationStatus: "matched", updatedAt: event.occurredAt },
      entries, `settlement.${event.type.toLowerCase()}`, event.eventId, event);
  }
  protected abstract callbackExists(id: string, eventId: string): Promise<boolean>;
  protected async require(id: string) { const value = await this.get(id); if (!value) throw new Error("Settlement not found"); return value; }
}

export class InMemorySettlementRepository extends BaseSettlementRepository {
  private settlements = new Map<string, Settlement>(); private ledger = new Map<string, LedgerEntry[]>();
  private callbacks = new Set<string>(); private version = 0;
  async create(s: Omit<Settlement, "etag">): Promise<Settlement> { const existing = this.settlements.get(s.id); if (existing) return existing;
    const value = { ...s, etag: this.etag() }; this.settlements.set(s.id, value);
    this.ledger.set(s.id, obligationEntries(s)); return value; }
  async get(id: string) { return this.settlements.get(id); }
  async listLedger(id: string) { return this.ledger.get(id) ?? []; }
  protected async callbackExists(id: string, eventId: string) { return this.callbacks.has(`${id}:${eventId}`); }
  async transact(id: string, etag: string, next: Omit<Settlement, "etag">, entries: readonly LedgerEntry[], _type: string, _details: string, callback?: ProviderEvent) {
    const current = this.settlements.get(id); if (!current || current.etag !== etag) throw new SettlementConflictError(id);
    if (callback) this.callbacks.add(`${id}:${callback.eventId}`);
    this.ledger.set(id, [...(this.ledger.get(id) ?? []), ...entries]);
    const value = { ...next, etag: this.etag() }; this.settlements.set(id, value); return value; }
  private etag() { this.version += 1; return `W/\"${this.version}\"`; }
}

export class AzureTableSettlementRepository extends BaseSettlementRepository {
  constructor(private table: TableClient) { super(); }
  async create(s: Omit<Settlement, "etag">, actor: string) { const existing = await this.get(s.id); if (existing) return existing;
    const tx = new TableTransaction(); tx.createEntity(profile(s));
    tx.createEntity({ partitionKey: s.id, rowKey: "FUNDING_INSTRUCTION", provider: "licensed-escrow-partner",
      providerReference: s.providerReference, amountMinor: s.totalAmountMinor, currencyCode: s.currencyCode, status: "pending" });
    for (const entry of obligationEntries(s)) tx.createEntity(posting(s.id, entry));
    tx.createEntity(audit(s.id, "settlement.created", s.createdAt, actor)); await this.submit(tx); return this.require(s.id); }
  async get(id: string) { try { return toSettlement(await this.table.getEntity<SettlementEntity>(id, "PROFILE")); }
    catch (e) { if (statusCode(e, 404)) return undefined; throw e; } }
  async listLedger(id: string) { const values: LedgerEntry[] = [];
    for await (const e of this.table.listEntities({ queryOptions: { filter: `PartitionKey eq '${id}' and RowKey ge 'JOURNAL:' and RowKey lt 'JOURNBL:'` } })) values.push(toEntry(e as TableEntity & Record<string, unknown>)); return values; }
  protected async callbackExists(id: string, eventId: string) { try { await this.table.getEntity(id, `CALLBACK:${eventId}`); return true; }
    catch (e) { if (statusCode(e, 404)) return false; throw e; } }
  async transact(id: string, etag: string, next: Omit<Settlement, "etag">, entries: readonly LedgerEntry[], eventType: string, details: string, callback?: ProviderEvent) {
    const tx = new TableTransaction(); tx.updateEntity(profile(next), "Replace", { etag });
    for (const entry of entries) tx.createEntity(posting(id, entry));
    if (callback) tx.createEntity({ partitionKey: id, rowKey: `CALLBACK:${callback.eventId}`, ...callback });
    tx.createEntity(audit(id, eventType, next.updatedAt, details)); await this.submit(tx); return this.require(id); }
  private async submit(tx: TableTransaction) { try { await this.table.submitTransaction(tx.actions); }
    catch (e) { if (statusCode(e, 409) || statusCode(e, 412)) throw new SettlementConflictError("Settlement conflict"); throw e; } }
}

function obligationEntries(s: Omit<Settlement, "etag">) { return journal("OBLIGATION", s.createdAt,
  [[`BUYER_RECEIVABLE:${s.buyerOrganizationId}`, "debit", s.totalAmountMinor],
   [`SELLER_PAYABLE:${s.sellerOrganizationId}`, "credit", s.grossAmountMinor],
  ["PLATFORM_FEE_REVENUE", "credit", s.feeAmountMinor]]); }
function statusCode(e: unknown, code: number) { return typeof e === "object" && e !== null && "statusCode" in e && e.statusCode === code; }
export function createSettlementRepository(): SettlementRepository {
  if (!hasTableStorageConfiguration()) { if (process.env.NODE_ENV === "production") throw new Error("Azure Table Storage configuration is required in production"); return new InMemorySettlementRepository(); }
  return new AzureTableSettlementRepository(createTableClient(process.env.AZURE_STORAGE_SETTLEMENTS_TABLE ?? "Settlements"));
}