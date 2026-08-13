import {
  TableClient,
  TableTransaction,
  type TableEntity,
} from "@azure/data-tables";
import { randomUUID } from "node:crypto";

import type { LotCategory } from "../inventory/inventory.repository.js";
import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";

export const PRODUCTION_UNIT_REPOSITORY = Symbol("PRODUCTION_UNIT_REPOSITORY");

export type ProductionUnitType =
  | "field"
  | "greenhouse"
  | "pond"
  | "tank"
  | "cage"
  | "barn"
  | "coop"
  | "pen"
  | "snailery"
  | "processingFacility";

export interface ProductionUnit {
  readonly id: string;
  readonly ownerOrganizationId: string;
  readonly type: ProductionUnitType;
  readonly name: string;
  readonly supportedCategory: LotCategory;
  readonly status: "active" | "inactive";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly etag: string;
}

export interface CreateProductionUnitInput {
  readonly ownerOrganizationId: string;
  readonly type: ProductionUnitType;
  readonly name: string;
  readonly supportedCategory: LotCategory;
  readonly actorUserId: string;
}

export class ProductionUnitConflictError extends Error {}

export interface ProductionUnitRepository {
  create(input: CreateProductionUnitInput): Promise<ProductionUnit>;
  get(id: string): Promise<ProductionUnit | undefined>;
  deactivate(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<ProductionUnit>;
}

interface ProductionUnitEntity extends TableEntity {
  readonly ownerOrganizationId: string;
  readonly type: ProductionUnitType;
  readonly name: string;
  readonly supportedCategory: LotCategory;
  readonly status: "active" | "inactive";
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toUnit(
  entity: ProductionUnitEntity & { readonly etag?: string },
): ProductionUnit {
  return {
    id: entity.partitionKey,
    ownerOrganizationId: entity.ownerOrganizationId,
    type: entity.type,
    name: entity.name,
    supportedCategory: entity.supportedCategory,
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    etag: entity.etag ?? "",
  };
}

function entity(unit: ProductionUnit): ProductionUnitEntity {
  return {
    partitionKey: unit.id,
    rowKey: "PROFILE",
    ownerOrganizationId: unit.ownerOrganizationId,
    type: unit.type,
    name: unit.name,
    supportedCategory: unit.supportedCategory,
    status: unit.status,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}

function event(
  unitId: string,
  eventType: string,
  actorUserId: string,
  occurredAt: string,
  details: string,
): TableEntity {
  return {
    partitionKey: unitId,
    rowKey: `EVENT:${occurredAt}:${randomUUID()}`,
    eventType,
    actorUserId,
    occurredAt,
    details,
  };
}

export class InMemoryProductionUnitRepository
  implements ProductionUnitRepository
{
  private readonly units = new Map<string, ProductionUnit>();
  private version = 0;

  async create(input: CreateProductionUnitInput): Promise<ProductionUnit> {
    const now = new Date().toISOString();
    const unit: ProductionUnit = {
      id: randomUUID(),
      ownerOrganizationId: input.ownerOrganizationId,
      type: input.type,
      name: input.name,
      supportedCategory: input.supportedCategory,
      status: "active",
      createdAt: now,
      updatedAt: now,
      etag: this.nextEtag(),
    };
    this.units.set(unit.id, unit);
    return unit;
  }

  async get(id: string): Promise<ProductionUnit | undefined> {
    return this.units.get(id);
  }

  async deactivate(
    id: string,
    _reason: string,
    etag: string,
  ): Promise<ProductionUnit> {
    const current = this.units.get(id);
    if (current === undefined) {
      return Promise.reject(new Error("Production unit not found"));
    }
    if (current.etag !== etag) {
      throw new ProductionUnitConflictError(id);
    }
    const updated = {
      ...current,
      status: "inactive" as const,
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.units.set(id, updated);
    return updated;
  }

  private nextEtag(): string {
    this.version += 1;
    return `W/\"${this.version}\"`;
  }
}

export class AzureTableProductionUnitRepository
  implements ProductionUnitRepository
{
  constructor(private readonly units: TableClient) {}

  async create(input: CreateProductionUnitInput): Promise<ProductionUnit> {
    const now = new Date().toISOString();
    const unit: ProductionUnit = {
      id: randomUUID(),
      ownerOrganizationId: input.ownerOrganizationId,
      type: input.type,
      name: input.name,
      supportedCategory: input.supportedCategory,
      status: "active",
      createdAt: now,
      updatedAt: now,
      etag: "",
    };
    const transaction = new TableTransaction();
    transaction.createEntity(entity(unit));
    transaction.createEntity(
      event(unit.id, "productionUnit.created", input.actorUserId, now, input.name),
    );
    await this.units.submitTransaction(transaction.actions);
    return this.requireUnit(unit.id);
  }

  async get(id: string): Promise<ProductionUnit | undefined> {
    try {
      return toUnit(
        await this.units.getEntity<ProductionUnitEntity>(id, "PROFILE"),
      );
    } catch (error: unknown) {
      if (isStatusCode(error, 404)) {
        return undefined;
      }
      throw error;
    }
  }

  async deactivate(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<ProductionUnit> {
    const current = await this.requireUnit(id);
    const now = new Date().toISOString();
    const transaction = new TableTransaction();
    transaction.updateEntity(
      entity({ ...current, status: "inactive", updatedAt: now }),
      "Replace",
      { etag },
    );
    transaction.createEntity(
      event(id, "productionUnit.deactivated", actorUserId, now, reason),
    );
    try {
      await this.units.submitTransaction(transaction.actions);
    } catch (error: unknown) {
      if (isStatusCode(error, 409) || isStatusCode(error, 412)) {
        throw new ProductionUnitConflictError(id);
      }
      throw error;
    }
    return this.requireUnit(id);
  }

  private async requireUnit(id: string): Promise<ProductionUnit> {
    const unit = await this.get(id);
    if (unit === undefined) {
      throw new Error("Production unit not found");
    }
    return unit;
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

export function createProductionUnitRepository(): ProductionUnitRepository {
  if (!hasTableStorageConfiguration()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Azure Table Storage configuration is required in production");
    }
    return new InMemoryProductionUnitRepository();
  }
  return new AzureTableProductionUnitRepository(
    createTableClient(
      process.env.AZURE_STORAGE_PRODUCTION_UNITS_TABLE ?? "ProductionUnits",
    ),
  );
}