import {
  TableClient,
  TableTransaction,
  type TableEntity,
} from "@azure/data-tables";
import { randomUUID } from "node:crypto";

import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";

export const INVENTORY_REPOSITORY = Symbol("INVENTORY_REPOSITORY");

export type LotCategory =
  | "crop"
  | "aquaculture"
  | "liveAnimal"
  | "animalProduct";
export type LotStatus =
  | "draft"
  | "available"
  | "reserved"
  | "quarantined"
  | "sold"
  | "inactive";

export interface LotQuantity {
  readonly value: number;
  readonly scale: number;
  readonly unitCode: string;
}

export interface InventoryLot {
  readonly id: string;
  readonly lotNumber: string;
  readonly ownerOrganizationId: string;
  readonly category: LotCategory;
  readonly commodityCode: string;
  readonly productionUnitId?: string;
  readonly productionDate?: string;
  readonly originRegionCode?: string;
  readonly quantity: LotQuantity;
  readonly status: LotStatus;
  readonly quarantineReason?: string;
  readonly statusBeforeQuarantine?: Exclude<LotStatus, "quarantined">;
  readonly soldRfqId?: string;
  readonly reservedRfqId?: string;
  readonly tradeId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly etag: string;
}

export interface CreateLotInput {
  readonly ownerOrganizationId: string;
  readonly category: LotCategory;
  readonly commodityCode: string;
  readonly productionUnitId?: string;
  readonly productionDate?: string;
  readonly originRegionCode?: string;
  readonly quantity: LotQuantity;
  readonly actorUserId: string;
}

export class InventoryNotFoundError extends Error {}
export class InventoryConflictError extends Error {}

export interface InventoryRepository {
  create(input: CreateLotInput): Promise<InventoryLot>;
  get(id: string): Promise<InventoryLot | undefined>;
  updateQuantity(
    id: string,
    quantity: LotQuantity,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot>;
  markAvailable(id: string, etag: string, actorUserId: string): Promise<InventoryLot>;
  quarantine(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot>;
  deactivate(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot>;
  markSold(
    id: string,
    rfqId: string,
    tradeId: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot>;
  reserveForSale(
    id: string,
    rfqId: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot>;
  releaseSaleReservation(
    id: string,
    rfqId: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot>;
  releaseQuarantine(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot>;
}

interface LotEntity extends TableEntity {
  readonly ownerOrganizationId: string;
  readonly category: LotCategory;
  readonly commodityCode: string;
  readonly productionUnitId?: string;
  readonly productionDate?: string;
  readonly originRegionCode?: string;
  readonly quantityValue: number;
  readonly quantityScale: number;
  readonly unitCode: string;
  readonly status: LotStatus;
  readonly quarantineReason?: string;
  readonly statusBeforeQuarantine?: Exclude<LotStatus, "quarantined">;
  readonly soldRfqId?: string;
  readonly reservedRfqId?: string;
  readonly tradeId?: string;
  readonly lotNumber?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function julianDate(now: Date = new Date()): { readonly yyddd: string } {
  const year = now.getUTCFullYear();
  const yy = String(year % 100).padStart(2, "0");
  const start = Date.UTC(year, 0, 1);
  const day = Math.floor((Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) - start) / 86_400_000) + 1;
  return { yyddd: `${yy}${String(day).padStart(3, "0")}` };
}

function formatLotNumber(yyddd: string, sequence: number): string {
  if (sequence < 1) throw new Error(`Sequence must be positive: ${sequence}`);
  const seqStr = String(sequence);
  if (seqStr.length > 5) throw new Error(`Daily sequence overflow: ${sequence}`);
  const n = seqStr.length;
  const padLength = 5 - n;
  let padding = "";
  for (let i = 0; i < padLength; i += 1) padding += String(Math.floor(Math.random() * 10));
  return `${yyddd}-${n}-${padding}${seqStr}`;
}

function toLot(entity: LotEntity & { readonly etag?: string }): InventoryLot {
  return {
    id: entity.partitionKey,
    lotNumber: entity.lotNumber ?? entity.partitionKey,
    ownerOrganizationId: entity.ownerOrganizationId,
    category: entity.category,
    commodityCode: entity.commodityCode,
    ...(entity.productionUnitId === undefined
      ? {}
      : { productionUnitId: entity.productionUnitId }),
    ...(entity.productionDate === undefined
      ? {}
      : { productionDate: entity.productionDate }),
    ...(entity.originRegionCode === undefined
      ? {}
      : { originRegionCode: entity.originRegionCode }),
    quantity: {
      value: entity.quantityValue,
      scale: entity.quantityScale,
      unitCode: entity.unitCode,
    },
    status: entity.status,
    ...(entity.quarantineReason === undefined
      ? {}
      : { quarantineReason: entity.quarantineReason }),
    ...(entity.statusBeforeQuarantine === undefined
      ? {}
      : { statusBeforeQuarantine: entity.statusBeforeQuarantine }),
    ...(entity.soldRfqId === undefined ? {} : { soldRfqId: entity.soldRfqId }),
    ...(entity.reservedRfqId === undefined
      ? {}
      : { reservedRfqId: entity.reservedRfqId }),
    ...(entity.tradeId === undefined ? {} : { tradeId: entity.tradeId }),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    etag: entity.etag ?? "",
  };
}

function profileEntity(lot: InventoryLot): LotEntity {
  return {
    partitionKey: lot.id,
    rowKey: "PROFILE",
    ownerOrganizationId: lot.ownerOrganizationId,
    category: lot.category,
    commodityCode: lot.commodityCode,
    ...(lot.productionUnitId === undefined
      ? {}
      : { productionUnitId: lot.productionUnitId }),
    ...(lot.productionDate === undefined
      ? {}
      : { productionDate: lot.productionDate }),
    ...(lot.originRegionCode === undefined
      ? {}
      : { originRegionCode: lot.originRegionCode }),
    quantityValue: lot.quantity.value,
    quantityScale: lot.quantity.scale,
    unitCode: lot.quantity.unitCode,
    status: lot.status,
    ...(lot.quarantineReason === undefined
      ? {}
      : { quarantineReason: lot.quarantineReason }),
    ...(lot.statusBeforeQuarantine === undefined
      ? {}
      : { statusBeforeQuarantine: lot.statusBeforeQuarantine }),
    ...(lot.soldRfqId === undefined ? {} : { soldRfqId: lot.soldRfqId }),
    ...(lot.reservedRfqId === undefined
      ? {}
      : { reservedRfqId: lot.reservedRfqId }),
    ...(lot.tradeId === undefined ? {} : { tradeId: lot.tradeId }),
    lotNumber: lot.lotNumber,
    createdAt: lot.createdAt,
    updatedAt: lot.updatedAt,
  };
}

function eventEntity(
  lotId: string,
  eventType: string,
  actorUserId: string,
  occurredAt: string,
  details: string,
): TableEntity {
  return {
    partitionKey: lotId,
    rowKey: `EVENT:${occurredAt}:${randomUUID()}`,
    eventType,
    actorUserId,
    occurredAt,
    details,
  };
}

export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly lots = new Map<string, InventoryLot>();
  private readonly dailySequence = new Map<string, number>();
  private version = 0;

  async create(input: CreateLotInput): Promise<InventoryLot> {
    const now = new Date();
    const nowIso = now.toISOString();
    const { yyddd } = julianDate(now);
    const sequence = (this.dailySequence.get(yyddd) ?? 0) + 1;
    this.dailySequence.set(yyddd, sequence);
    const lot: InventoryLot = {
      id: randomUUID(),
      lotNumber: formatLotNumber(yyddd, sequence),
      ownerOrganizationId: input.ownerOrganizationId,
      category: input.category,
      commodityCode: input.commodityCode,
      ...(input.productionUnitId === undefined
        ? {}
        : { productionUnitId: input.productionUnitId }),
      ...(input.productionDate === undefined
        ? {}
        : { productionDate: input.productionDate }),
      ...(input.originRegionCode === undefined
        ? {}
        : { originRegionCode: input.originRegionCode }),
      quantity: input.quantity,
      status: "draft",
      createdAt: nowIso,
      updatedAt: nowIso,
      etag: this.nextEtag(),
    };
    this.lots.set(lot.id, lot);
    return lot;
  }

  async get(id: string): Promise<InventoryLot | undefined> {
    return this.lots.get(id);
  }

  async updateQuantity(
    id: string,
    quantity: LotQuantity,
    etag: string,
  ): Promise<InventoryLot> {
    return this.change(id, etag, { quantity });
  }

  async markAvailable(id: string, etag: string): Promise<InventoryLot> {
    return this.change(id, etag, { status: "available" });
  }

  async quarantine(
    id: string,
    reason: string,
    etag: string,
  ): Promise<InventoryLot> {
    const current = this.lots.get(id);
    return this.change(id, etag, {
      status: "quarantined",
      quarantineReason: reason,
      ...(current === undefined || current.status === "quarantined"
        ? {}
        : { statusBeforeQuarantine: current.status }),
    });
  }

  async releaseQuarantine(id: string, _reason: string, etag: string): Promise<InventoryLot> {
    const current = this.lots.get(id);
    if (current?.status !== "quarantined") throw new InventoryConflictError(id);
    if (current.etag !== etag) throw new InventoryConflictError(id);
    const { quarantineReason: _reasonValue, statusBeforeQuarantine, ...rest } = current;
    const updated: InventoryLot = { ...rest, status: statusBeforeQuarantine ?? "draft",
      updatedAt: new Date().toISOString(), etag: this.nextEtag() };
    this.lots.set(id, updated); return updated;
  }

  async deactivate(id: string, _reason: string, etag: string): Promise<InventoryLot> {
    return this.change(id, etag, { status: "inactive" });
  }

  async markSold(
    id: string,
    rfqId: string,
    tradeId: string,
    etag: string,
  ): Promise<InventoryLot> {
    const current = this.lots.get(id);
    if (
      current?.status === "sold" &&
      current.soldRfqId === rfqId &&
      current.tradeId === tradeId
    ) {
      return current;
    }
    return this.change(id, etag, { status: "sold", soldRfqId: rfqId, tradeId });
  }

  async reserveForSale(id: string, rfqId: string, etag: string): Promise<InventoryLot> {
    const current = this.lots.get(id);
    if (current?.status === "reserved" && current.reservedRfqId === rfqId) return current;
    return this.change(id, etag, { status: "reserved", reservedRfqId: rfqId });
  }

  async releaseSaleReservation(id: string, rfqId: string, etag: string): Promise<InventoryLot> {
    const current = this.lots.get(id);
    if (current?.status === "available" && current.reservedRfqId === undefined) return current;
    if (current?.status !== "reserved" || current.reservedRfqId !== rfqId) throw new InventoryConflictError(id);
    const { reservedRfqId: _reserved, ...rest } = current;
    if (current.etag !== etag) throw new InventoryConflictError(id);
    const updated: InventoryLot = {
      ...rest,
      status: "available",
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.lots.set(id, updated);
    return updated;
  }

  private change(
    id: string,
    etag: string,
    changes: Partial<InventoryLot>,
  ): InventoryLot {
    const current = this.lots.get(id);
    if (current === undefined) {
      throw new InventoryNotFoundError(id);
    }
    if (current.etag !== etag) {
      throw new InventoryConflictError(id);
    }
    const updated = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.lots.set(id, updated);
    return updated;
  }

  private nextEtag(): string {
    this.version += 1;
    return `W/\"${this.version}\"`;
  }
}

export class AzureTableInventoryRepository implements InventoryRepository {
  constructor(private readonly inventory: TableClient) {}

  async create(input: CreateLotInput): Promise<InventoryLot> {
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const { yyddd } = julianDate(nowDate);
    const sequence = await this.nextDailySequence(yyddd);
    const lot: InventoryLot = {
      id: randomUUID(),
      lotNumber: formatLotNumber(yyddd, sequence),
      ownerOrganizationId: input.ownerOrganizationId,
      category: input.category,
      commodityCode: input.commodityCode,
      ...(input.productionUnitId === undefined
        ? {}
        : { productionUnitId: input.productionUnitId }),
      ...(input.productionDate === undefined
        ? {}
        : { productionDate: input.productionDate }),
      ...(input.originRegionCode === undefined
        ? {}
        : { originRegionCode: input.originRegionCode }),
      quantity: input.quantity,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      etag: "",
    };
    const transaction = new TableTransaction();
    transaction.createEntity(profileEntity(lot));
    transaction.createEntity(
      eventEntity(
        lot.id,
        "lot.created",
        input.actorUserId,
        now,
        input.commodityCode,
      ),
    );
    await this.inventory.submitTransaction(transaction.actions);
    return this.requireLot(lot.id);
  }

  private async nextDailySequence(yyddd: string): Promise<number> {
    const partitionKey = `LOTSEQ:${yyddd}`;
    const rowKey = "COUNTER";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const entity = await this.inventory.getEntity<TableEntity & { sequence: number }>(partitionKey, rowKey);
        const next = (Number(entity.sequence) || 0) + 1;
        try {
          await this.inventory.updateEntity(
            { partitionKey, rowKey, sequence: next },
            "Replace",
            { etag: entity.etag as string },
          );
          return next;
        } catch (updateErr: unknown) {
          if (isStatusCode(updateErr, 412) || isStatusCode(updateErr, 409)) continue;
          throw updateErr;
        }
      } catch (err: unknown) {
        if (!isStatusCode(err, 404)) throw err;
        try {
          await this.inventory.createEntity({ partitionKey, rowKey, sequence: 1 });
          return 1;
        } catch (createErr: unknown) {
          if (isStatusCode(createErr, 409)) continue;
          throw createErr;
        }
      }
    }
    throw new Error(`Unable to reserve lot number sequence for ${yyddd}`);
  }

  async get(id: string): Promise<InventoryLot | undefined> {
    try {
      return toLot(await this.inventory.getEntity<LotEntity>(id, "PROFILE"));
    } catch (error: unknown) {
      if (isStatusCode(error, 404)) {
        return undefined;
      }
      throw error;
    }
  }

  async updateQuantity(
    id: string,
    quantity: LotQuantity,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    return this.change(
      id,
      etag,
      actorUserId,
      "lot.quantity.updated",
      JSON.stringify(quantity),
      (lot) => ({ ...lot, quantity }),
    );
  }

  async markAvailable(
    id: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    return this.change(
      id,
      etag,
      actorUserId,
      "lot.markedAvailable",
      "available",
      (lot) => ({ ...lot, status: "available" }),
    );
  }

  async quarantine(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    return this.change(
      id,
      etag,
      actorUserId,
      "lot.quarantined",
      reason,
      (lot) => ({
        ...lot,
        status: "quarantined",
        quarantineReason: reason,
        ...(lot.status === "quarantined"
          ? {}
          : { statusBeforeQuarantine: lot.status }),
      }),
    );
  }

  async releaseQuarantine(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    const current = await this.requireLot(id);
    if (current.status !== "quarantined") throw new InventoryConflictError(id);
    return this.change(id, etag, actorUserId, "lot.quarantineReleased", reason,
      (lot) => { const { quarantineReason: _reasonValue, statusBeforeQuarantine, ...rest } = lot;
        return { ...rest, status: statusBeforeQuarantine ?? "draft" }; });
  }

  async deactivate(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    return this.change(
      id,
      etag,
      actorUserId,
      "lot.deactivated",
      reason,
      (lot) => ({ ...lot, status: "inactive" }),
    );
  }

  async markSold(
    id: string,
    rfqId: string,
    tradeId: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    const current = await this.requireLot(id);
    if (
      current.status === "sold" &&
      current.soldRfqId === rfqId &&
      current.tradeId === tradeId
    ) {
      return current;
    }
    if (current.status !== "reserved" || current.reservedRfqId !== rfqId) {
      throw new InventoryConflictError("Lot is not available for sale");
    }
    return this.change(
      id,
      etag,
      actorUserId,
      "lot.sold",
      tradeId,
      (lot) => {
        const { reservedRfqId: _reserved, ...rest } = lot;
        return { ...rest, status: "sold", soldRfqId: rfqId, tradeId };
      },
    );
  }

  async reserveForSale(
    id: string,
    rfqId: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    const current = await this.requireLot(id);
    if (current.status === "reserved" && current.reservedRfqId === rfqId) return current;
    if (current.status !== "available") throw new InventoryConflictError(id);
    return this.change(id, etag, actorUserId, "lot.reserved", rfqId,
      (lot) => ({ ...lot, status: "reserved", reservedRfqId: rfqId }));
  }

  async releaseSaleReservation(
    id: string,
    rfqId: string,
    etag: string,
    actorUserId: string,
  ): Promise<InventoryLot> {
    const current = await this.requireLot(id);
    if (current.status === "available" && current.reservedRfqId === undefined) return current;
    if (current.status !== "reserved" || current.reservedRfqId !== rfqId) throw new InventoryConflictError(id);
    return this.change(id, etag, actorUserId, "lot.reservationReleased", rfqId,
      (lot) => { const { reservedRfqId: _reserved, ...rest } = lot; return { ...rest, status: "available" }; });
  }

  private async change(
    id: string,
    etag: string,
    actorUserId: string,
    eventType: string,
    details: string,
    apply: (lot: InventoryLot) => InventoryLot,
  ): Promise<InventoryLot> {
    const current = await this.requireLot(id);
    const now = new Date().toISOString();
    const updated = { ...apply(current), updatedAt: now };
    const transaction = new TableTransaction();
    transaction.updateEntity(profileEntity(updated), "Replace", { etag });
    transaction.createEntity(
      eventEntity(id, eventType, actorUserId, now, details),
    );
    try {
      await this.inventory.submitTransaction(transaction.actions);
    } catch (error: unknown) {
      if (isStatusCode(error, 409) || isStatusCode(error, 412)) {
        throw new InventoryConflictError(id);
      }
      throw error;
    }
    return this.requireLot(id);
  }

  private async requireLot(id: string): Promise<InventoryLot> {
    const lot = await this.get(id);
    if (lot === undefined) {
      throw new InventoryNotFoundError(id);
    }
    return lot;
  }
}

function isStatusCode(error: unknown, statusCode: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === statusCode
  );
}

export function createInventoryRepository(): InventoryRepository {
  if (!hasTableStorageConfiguration()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Azure Table Storage configuration is required in production");
    }
    return new InMemoryInventoryRepository();
  }
  return new AzureTableInventoryRepository(
    createTableClient(process.env.AZURE_STORAGE_INVENTORY_TABLE ?? "Inventory"),
  );
}