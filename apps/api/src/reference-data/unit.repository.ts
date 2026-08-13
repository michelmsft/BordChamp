import { TableClient, type TableEntity } from "@azure/data-tables";
import { Logger } from "@nestjs/common";

import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";

export const UNIT_REPOSITORY = Symbol("UNIT_REPOSITORY");

export type UnitDimension = "mass" | "count" | "volume" | "length" | "temperature";
export type UnitStatus = "active" | "suspended" | "inactive";

export interface Unit {
  readonly code: string;
  readonly label: { readonly en: string; readonly fr: string };
  readonly dimension: UnitDimension;
  readonly baseUnitCode?: string;
  readonly factorToBase?: number;
  readonly scale: number;
  readonly status: UnitStatus;
}

export interface UpsertUnitInput {
  readonly code: string;
  readonly labelEn: string;
  readonly labelFr: string;
  readonly dimension: UnitDimension;
  readonly baseUnitCode?: string;
  readonly factorToBase?: number;
  readonly scale: number;
  readonly status: UnitStatus;
}

export interface UnitRepository {
  listActive(): Promise<readonly Unit[]>;
  listAll(): Promise<readonly Unit[]>;
  upsert(input: UpsertUnitInput): Promise<Unit>;
}

interface UnitEntity extends TableEntity {
  readonly labelEn: string;
  readonly labelFr: string;
  readonly dimension: UnitDimension;
  readonly baseUnitCode?: string;
  readonly factorToBase?: number;
  readonly scale: number;
  readonly status: UnitStatus;
}

const UNIT_PARTITION = "UNIT";

const seedUnits: readonly Unit[] = [
  { code: "KG", label: { en: "Kilogram", fr: "Kilogramme" }, dimension: "mass", scale: 3, status: "active" },
  { code: "G", label: { en: "Gram", fr: "Gramme" }, dimension: "mass", baseUnitCode: "KG", factorToBase: 0.001, scale: 0, status: "active" },
  { code: "T", label: { en: "Metric ton", fr: "Tonne" }, dimension: "mass", baseUnitCode: "KG", factorToBase: 1000, scale: 3, status: "active" },
  { code: "COUNT", label: { en: "Unit", fr: "Unité" }, dimension: "count", scale: 0, status: "active" },
  { code: "L", label: { en: "Litre", fr: "Litre" }, dimension: "volume", scale: 2, status: "active" },
  { code: "CELSIUS", label: { en: "Celsius", fr: "Celsius" }, dimension: "temperature", scale: 1, status: "active" },
];

function toEntity(input: UpsertUnitInput): UnitEntity {
  return {
    partitionKey: UNIT_PARTITION,
    rowKey: input.code,
    labelEn: input.labelEn,
    labelFr: input.labelFr,
    dimension: input.dimension,
    ...(input.baseUnitCode ? { baseUnitCode: input.baseUnitCode } : {}),
    ...(input.factorToBase !== undefined ? { factorToBase: input.factorToBase } : {}),
    scale: input.scale,
    status: input.status,
  };
}

function fromEntity(entity: UnitEntity): Unit {
  return {
    code: entity.rowKey,
    label: { en: entity.labelEn, fr: entity.labelFr },
    dimension: entity.dimension,
    ...(entity.baseUnitCode ? { baseUnitCode: entity.baseUnitCode } : {}),
    ...(entity.factorToBase !== undefined ? { factorToBase: entity.factorToBase } : {}),
    scale: entity.scale,
    status: entity.status,
  };
}

export class InMemoryUnitRepository implements UnitRepository {
  private readonly store = new Map<string, Unit>(seedUnits.map((u) => [u.code, u]));

  async listActive(): Promise<readonly Unit[]> {
    return [...this.store.values()].filter((u) => u.status === "active").sort((a, b) => a.code.localeCompare(b.code));
  }

  async listAll(): Promise<readonly Unit[]> {
    return [...this.store.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async upsert(input: UpsertUnitInput): Promise<Unit> {
    const unit = fromEntity(toEntity(input));
    this.store.set(unit.code, unit);
    return unit;
  }
}

export class AzureTableUnitRepository implements UnitRepository {
  constructor(private readonly client: TableClient) {}

  async listActive(): Promise<readonly Unit[]> {
    return (await this.listAll()).filter((u) => u.status === "active");
  }

  async listAll(): Promise<readonly Unit[]> {
    const items: Unit[] = [];
    const entities = this.client.listEntities<UnitEntity>({
      queryOptions: { filter: `PartitionKey eq '${UNIT_PARTITION}'` },
    });
    for await (const entity of entities) items.push(fromEntity(entity));
    return items.sort((a, b) => a.code.localeCompare(b.code));
  }

  async upsert(input: UpsertUnitInput): Promise<Unit> {
    const entity = toEntity(input);
    await this.client.upsertEntity(entity, "Replace");
    return fromEntity(entity);
  }
}

export function createUnitRepository(): UnitRepository {
  if (!hasTableStorageConfiguration()) return new InMemoryUnitRepository();
  const tableName = process.env.AZURE_STORAGE_COMMODITIES_TABLE ?? "ReferenceData";
  new Logger("UnitRepository").log(`Using Azure Table Storage table ${tableName}`);
  return new AzureTableUnitRepository(createTableClient(tableName));
}
