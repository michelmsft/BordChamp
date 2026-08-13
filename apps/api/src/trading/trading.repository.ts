import { TableClient, TableTransaction, type TableEntity } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import type { LotQuantity } from "../inventory/inventory.repository.js";
import { createTableClient, hasTableStorageConfiguration } from "../storage/table-client.js";

export const TRADING_REPOSITORY = Symbol("TRADING_REPOSITORY");

export interface SellRfq {
  readonly id: string;
  readonly lotId: string;
  readonly sellerOrganizationId: string;
  readonly commodityCode: string;
  readonly quantity: LotQuantity;
  readonly invitedBuyerOrganizationIds: readonly string[];
  readonly currencyCode: "XOF";
  readonly expiresAt: string;
  readonly status: "open" | "accepted" | "cancelled";
  readonly acceptedQuoteId?: string;
  readonly tradeId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly etag: string;
}

export interface Quote {
  readonly id: string;
  readonly rfqId: string;
  readonly buyerOrganizationId: string;
  readonly unitPriceMinor: number;
  readonly grossAmountMinor: number;
  readonly feeAmountMinor: number;
  readonly totalAmountMinor: number;
  readonly currencyCode: "XOF";
  readonly createdAt: string;
}

export interface TradeConfirmation {
  readonly id: string;
  readonly rfqId: string;
  readonly quoteId: string;
  readonly lotId: string;
  readonly sellerOrganizationId: string;
  readonly buyerOrganizationId: string;
  readonly commodityCode: string;
  readonly quantity: LotQuantity;
  readonly unitPriceMinor: number;
  readonly grossAmountMinor: number;
  readonly feeAmountMinor: number;
  readonly totalAmountMinor: number;
  readonly currencyCode: "XOF";
  readonly executedAt: string;
}

export class TradingConflictError extends Error {}

export interface TradingRepository {
  create(rfq: Omit<SellRfq, "etag">, actorUserId: string): Promise<SellRfq>;
  get(id: string): Promise<SellRfq | undefined>;
  createQuote(quote: Quote, actorUserId: string): Promise<Quote>;
  getQuote(rfqId: string, quoteId: string): Promise<Quote | undefined>;
  listQuotes(rfqId: string): Promise<readonly Quote[]>;
  cancel(id: string, reason: string, etag: string, actorUserId: string): Promise<SellRfq>;
  accept(
    id: string,
    quote: Quote,
    trade: TradeConfirmation,
    etag: string,
    actorUserId: string,
  ): Promise<SellRfq>;
  getTrade(rfqId: string, tradeId: string): Promise<TradeConfirmation | undefined>;
}

interface RfqEntity extends TableEntity {
  lotId: string; sellerOrganizationId: string; commodityCode: string;
  quantityValue: number; quantityScale: number; unitCode: string;
  invitedBuyersJson: string; currencyCode: "XOF"; expiresAt: string;
  status: "open" | "accepted" | "cancelled"; acceptedQuoteId?: string;
  tradeId?: string; createdAt: string; updatedAt: string;
}

function rfqEntity(r: Omit<SellRfq, "etag">): RfqEntity {
  return {
    partitionKey: r.id, rowKey: "PROFILE", lotId: r.lotId,
    sellerOrganizationId: r.sellerOrganizationId, commodityCode: r.commodityCode,
    quantityValue: r.quantity.value, quantityScale: r.quantity.scale,
    unitCode: r.quantity.unitCode, invitedBuyersJson: JSON.stringify(r.invitedBuyerOrganizationIds),
    currencyCode: r.currencyCode, expiresAt: r.expiresAt, status: r.status,
    ...(r.acceptedQuoteId === undefined ? {} : { acceptedQuoteId: r.acceptedQuoteId }),
    ...(r.tradeId === undefined ? {} : { tradeId: r.tradeId }),
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function toRfq(e: RfqEntity & { etag?: string }): SellRfq {
  return {
    id: e.partitionKey, lotId: e.lotId, sellerOrganizationId: e.sellerOrganizationId,
    commodityCode: e.commodityCode,
    quantity: { value: e.quantityValue, scale: e.quantityScale, unitCode: e.unitCode },
    invitedBuyerOrganizationIds: JSON.parse(e.invitedBuyersJson) as string[],
    currencyCode: e.currencyCode, expiresAt: e.expiresAt, status: e.status,
    ...(e.acceptedQuoteId === undefined ? {} : { acceptedQuoteId: e.acceptedQuoteId }),
    ...(e.tradeId === undefined ? {} : { tradeId: e.tradeId }),
    createdAt: e.createdAt, updatedAt: e.updatedAt, etag: e.etag ?? "",
  };
}

function quoteEntity(q: Quote): TableEntity {
  return { partitionKey: q.rfqId, rowKey: `QUOTE:${q.id}`, quoteId: q.id,
    buyerOrganizationId: q.buyerOrganizationId, unitPriceMinor: q.unitPriceMinor,
    grossAmountMinor: q.grossAmountMinor, feeAmountMinor: q.feeAmountMinor,
    totalAmountMinor: q.totalAmountMinor, currencyCode: q.currencyCode, createdAt: q.createdAt };
}

function toQuote(e: TableEntity & Record<string, unknown>, rfqId = e.partitionKey): Quote {
  return { id: e.quoteId as string, rfqId,
    buyerOrganizationId: e.buyerOrganizationId as string,
    unitPriceMinor: e.unitPriceMinor as number, grossAmountMinor: e.grossAmountMinor as number,
    feeAmountMinor: e.feeAmountMinor as number, totalAmountMinor: e.totalAmountMinor as number,
    currencyCode: "XOF", createdAt: e.createdAt as string };
}

function tradeEntity(t: TradeConfirmation): TableEntity {
  const { quantity, ...scalarFields } = t;
  return { partitionKey: t.rfqId, rowKey: `TRADE:${t.id}`, ...scalarFields,
    quantityJson: JSON.stringify(quantity) };
}

function toTrade(e: TableEntity & Record<string, unknown>): TradeConfirmation {
  return { id: e.id as string, rfqId: e.rfqId as string, quoteId: e.quoteId as string,
    lotId: e.lotId as string, sellerOrganizationId: e.sellerOrganizationId as string,
    buyerOrganizationId: e.buyerOrganizationId as string, commodityCode: e.commodityCode as string,
    quantity: JSON.parse(e.quantityJson as string) as LotQuantity,
    unitPriceMinor: e.unitPriceMinor as number, grossAmountMinor: e.grossAmountMinor as number,
    feeAmountMinor: e.feeAmountMinor as number, totalAmountMinor: e.totalAmountMinor as number,
    currencyCode: "XOF", executedAt: e.executedAt as string };
}

function event(id: string, type: string, actor: string, at: string, details: string): TableEntity {
  return { partitionKey: id, rowKey: `EVENT:${at}:${randomUUID()}`, eventType: type,
    actorUserId: actor, occurredAt: at, details };
}

export class InMemoryTradingRepository implements TradingRepository {
  private rfqs = new Map<string, SellRfq>(); private quotes = new Map<string, Quote>();
  private trades = new Map<string, TradeConfirmation>(); private version = 0;
  async create(r: Omit<SellRfq, "etag">): Promise<SellRfq> {
    if (this.rfqs.has(r.id)) throw new TradingConflictError(r.id);
    const value = { ...r, etag: this.etag() }; this.rfqs.set(r.id, value); return value;
  }
  async get(id: string) { return this.rfqs.get(id); }
  async createQuote(q: Quote) { const key = `${q.rfqId}:${q.id}`;
    if (this.quotes.has(key)) throw new TradingConflictError(key); this.quotes.set(key, q); return q; }
  async getQuote(r: string, q: string) { return this.quotes.get(`${r}:${q}`); }
  async listQuotes(r: string) { return [...this.quotes.values()].filter(q => q.rfqId === r); }
  async cancel(id: string, _reason: string, etag: string) { return this.change(id, etag, { status: "cancelled" }); }
  async accept(id: string, q: Quote, t: TradeConfirmation, etag: string) {
    const current = this.rfqs.get(id); if (current?.status === "accepted" && current.tradeId === t.id) return current;
    this.trades.set(`${id}:${t.id}`, t); return this.change(id, etag, { status: "accepted", acceptedQuoteId: q.id, tradeId: t.id });
  }
  async getTrade(r: string, t: string) { return this.trades.get(`${r}:${t}`); }
  private change(id: string, etag: string, changes: Partial<SellRfq>) { const c = this.rfqs.get(id);
    if (!c || c.etag !== etag) throw new TradingConflictError(id);
    const n = { ...c, ...changes, updatedAt: new Date().toISOString(), etag: this.etag() }; this.rfqs.set(id, n); return n; }
  private etag() { this.version += 1; return `W/\"${this.version}\"`; }
}

export class AzureTableTradingRepository implements TradingRepository {
  constructor(private table: TableClient) {}
  async create(r: Omit<SellRfq, "etag">, actor: string) { const tx = new TableTransaction();
    tx.createEntity(rfqEntity(r)); tx.createEntity(event(r.id, "rfq.created", actor, r.createdAt, r.lotId));
    await this.submit(tx); return this.requireRfq(r.id); }
  async get(id: string) { try { return toRfq(await this.table.getEntity<RfqEntity>(id, "PROFILE")); }
    catch (e) { if (status(e, 404)) return undefined; throw e; } }
  async createQuote(q: Quote, actor: string) { const tx = new TableTransaction(); tx.createEntity(quoteEntity(q));
    tx.createEntity(event(q.rfqId, "quote.submitted", actor, q.createdAt, q.id)); await this.submit(tx); return q; }
  async getQuote(r: string, q: string) { try { return toQuote(await this.table.getEntity(r, `QUOTE:${q}`)); }
    catch (e) { if (status(e, 404)) return undefined; throw e; } }
  async listQuotes(r: string) { const out: Quote[] = []; for await (const e of this.table.listEntities({ queryOptions: { filter: `PartitionKey eq '${r}' and RowKey ge 'QUOTE:' and RowKey lt 'QUOTF:'` } })) out.push(toQuote(e as TableEntity & Record<string, unknown>, r)); return out; }
  async cancel(id: string, reason: string, etag: string, actor: string) { const c = await this.requireRfq(id); const now = new Date().toISOString();
    const tx = new TableTransaction(); tx.updateEntity(rfqEntity({ ...c, status: "cancelled", updatedAt: now }), "Replace", { etag });
    tx.createEntity(event(id, "rfq.cancelled", actor, now, reason)); await this.submit(tx); return this.requireRfq(id); }
  async accept(id: string, q: Quote, t: TradeConfirmation, etag: string, actor: string) { const c = await this.requireRfq(id);
    if (c.status === "accepted" && c.tradeId === t.id) return c; const tx = new TableTransaction();
    tx.updateEntity(rfqEntity({ ...c, status: "accepted", acceptedQuoteId: q.id, tradeId: t.id, updatedAt: t.executedAt }), "Replace", { etag });
    tx.createEntity(tradeEntity(t)); tx.createEntity(event(id, "rfq.accepted", actor, t.executedAt, t.id)); await this.submit(tx); return this.requireRfq(id); }
  async getTrade(r: string, t: string) { try { return toTrade(await this.table.getEntity(r, `TRADE:${t}`)); }
    catch (e) { if (status(e, 404)) return undefined; throw e; } }
  private async requireRfq(id: string) { const r = await this.get(id); if (!r) throw new Error("RFQ not found"); return r; }
  private async submit(tx: TableTransaction) { try { await this.table.submitTransaction(tx.actions); }
    catch (e) { if (status(e, 409) || status(e, 412)) throw new TradingConflictError("Trading conflict"); throw e; } }
}

function status(e: unknown, code: number) { return typeof e === "object" && e !== null && "statusCode" in e && e.statusCode === code; }
export function createTradingRepository(): TradingRepository {
  if (!hasTableStorageConfiguration()) { if (process.env.NODE_ENV === "production") throw new Error("Azure Table Storage configuration is required in production"); return new InMemoryTradingRepository(); }
  return new AzureTableTradingRepository(createTableClient(process.env.AZURE_STORAGE_TRADING_TABLE ?? "Trading"));
}