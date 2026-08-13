import { TableClient, type TableEntity } from "@azure/data-tables";
import { Logger } from "@nestjs/common";

import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";

export const COMMODITY_REPOSITORY = Symbol("COMMODITY_REPOSITORY");

export type CommodityCategory =
  | "crop"
  | "aquaculture"
  | "liveAnimal"
  | "animalProduct";

export type CommodityStatus = "active" | "suspended" | "inactive";

export interface PublicCommodity {
  readonly code: string;
  readonly category: CommodityCategory;
  readonly name: {
    readonly en: string;
    readonly fr: string;
  };
  readonly iconName?: string;
  readonly public: true;
}

export interface AdminCommodity {
  readonly code: string;
  readonly category: CommodityCategory;
  readonly name: {
    readonly en: string;
    readonly fr: string;
  };
  readonly iconName?: string;
  readonly defaultUnitCode?: string;
  readonly allowedUnitCodes: readonly string[];
  readonly isPublic: boolean;
  readonly status: CommodityStatus;
  readonly effectiveFrom: string;
}

export interface UpsertCommodityInput {
  readonly code: string;
  readonly category: CommodityCategory;
  readonly nameEn: string;
  readonly nameFr: string;
  readonly iconName?: string;
  readonly defaultUnitCode?: string;
  readonly allowedUnitCodes?: readonly string[];
  readonly isPublic: boolean;
  readonly status: CommodityStatus;
}

export interface CommodityRepository {
  listPublicActive(): Promise<readonly PublicCommodity[]>;
  listAll(): Promise<readonly AdminCommodity[]>;
  upsert(input: UpsertCommodityInput): Promise<AdminCommodity>;
}

interface CommodityTableEntity extends TableEntity {
  readonly category: CommodityCategory;
  readonly nameEn: string;
  readonly nameFr: string;
  readonly iconName?: string;
  readonly defaultUnitCode?: string;
  readonly allowedUnitCodesJson?: string;
  readonly isPublic: boolean;
  readonly status: CommodityStatus;
  readonly effectiveFrom: string;
}

const PUBLIC_COMMODITY_PARTITION = "PUBLIC_COMMODITY";

const pilotCommodities: readonly AdminCommodity[] = [
  {
    code: "TOMATO",
    category: "crop",
    name: { en: "Tomato", fr: "Tomate" },
    iconName: "cherry",
    defaultUnitCode: "KG",
    allowedUnitCodes: ["KG"],
    isPublic: true,
    status: "active",
    effectiveFrom: "2026-08-12T00:00:00.000Z",
  },
  {
    code: "TILAPIA",
    category: "aquaculture",
    name: { en: "Tilapia", fr: "Tilapia" },
    iconName: "fish",
    defaultUnitCode: "KG",
    allowedUnitCodes: ["KG"],
    isPublic: true,
    status: "active",
    effectiveFrom: "2026-08-12T00:00:00.000Z",
  },
  {
    code: "BROILER_CHICKEN",
    category: "liveAnimal",
    name: { en: "Broiler chicken", fr: "Poulet de chair" },
    iconName: "bird",
    defaultUnitCode: "COUNT",
    allowedUnitCodes: ["COUNT", "KG"],
    isPublic: true,
    status: "active",
    effectiveFrom: "2026-08-12T00:00:00.000Z",
  },
  {
    code: "TABLE_EGG",
    category: "animalProduct",
    name: { en: "Table egg", fr: "Oeuf de consommation" },
    iconName: "egg",
    defaultUnitCode: "COUNT",
    allowedUnitCodes: ["COUNT"],
    isPublic: true,
    status: "active",
    effectiveFrom: "2026-08-12T00:00:00.000Z",
  },
];

function toPublic(admin: AdminCommodity): PublicCommodity {
  return {
    code: admin.code,
    category: admin.category,
    name: admin.name,
    ...(admin.iconName ? { iconName: admin.iconName } : {}),
    public: true,
  };
}

export class InMemoryCommodityRepository implements CommodityRepository {
  private readonly store = new Map<string, AdminCommodity>(
    pilotCommodities.map((c) => [c.code, c]),
  );

  async listPublicActive(): Promise<readonly PublicCommodity[]> {
    return [...this.store.values()]
      .filter((c) => c.isPublic && c.status === "active")
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(toPublic);
  }

  async listAll(): Promise<readonly AdminCommodity[]> {
    return [...this.store.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async upsert(input: UpsertCommodityInput): Promise<AdminCommodity> {
    const previous = this.store.get(input.code);
    const record: AdminCommodity = {
      code: input.code,
      category: input.category,
      name: { en: input.nameEn, fr: input.nameFr },
      ...(input.iconName ? { iconName: input.iconName } : {}),
      ...(input.defaultUnitCode ? { defaultUnitCode: input.defaultUnitCode } : {}),
      allowedUnitCodes: input.allowedUnitCodes ?? [],
      isPublic: input.isPublic,
      status: input.status,
      effectiveFrom: previous?.effectiveFrom ?? new Date().toISOString(),
    };
    this.store.set(input.code, record);
    return record;
  }
}

export class AzureTableCommodityRepository implements CommodityRepository {
  constructor(private readonly client: TableClient) {}

  async listPublicActive(): Promise<readonly PublicCommodity[]> {
    const commodities: PublicCommodity[] = [];
    const entities = this.client.listEntities<CommodityTableEntity>({
      queryOptions: {
        filter: [
          `PartitionKey eq '${PUBLIC_COMMODITY_PARTITION}'`,
          "isPublic eq true",
          "status eq 'active'",
        ].join(" and "),
        select: ["RowKey", "category", "nameEn", "nameFr", "iconName"],
      },
    });

    for await (const entity of entities) {
      commodities.push({
        code: entity.rowKey,
        category: entity.category,
        name: { en: entity.nameEn, fr: entity.nameFr },
        ...(entity.iconName ? { iconName: entity.iconName } : {}),
        public: true,
      });
    }

    return commodities.sort((left, right) => left.code.localeCompare(right.code));
  }

  async listAll(): Promise<readonly AdminCommodity[]> {
    const commodities: AdminCommodity[] = [];
    const entities = this.client.listEntities<CommodityTableEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${PUBLIC_COMMODITY_PARTITION}'`,
      },
    });

    for await (const entity of entities) {
      commodities.push(toAdmin(entity));
    }

    return commodities.sort((left, right) => left.code.localeCompare(right.code));
  }

  async upsert(input: UpsertCommodityInput): Promise<AdminCommodity> {
    let effectiveFrom = new Date().toISOString();
    try {
      const existing = await this.client.getEntity<CommodityTableEntity>(
        PUBLIC_COMMODITY_PARTITION,
        input.code,
      );
      effectiveFrom = existing.effectiveFrom;
    } catch {
      // new commodity — keep the fresh timestamp
    }
    const entity: CommodityTableEntity = {
      partitionKey: PUBLIC_COMMODITY_PARTITION,
      rowKey: input.code,
      category: input.category,
      nameEn: input.nameEn,
      nameFr: input.nameFr,
      ...(input.iconName ? { iconName: input.iconName } : {}),
      ...(input.defaultUnitCode ? { defaultUnitCode: input.defaultUnitCode } : {}),
      ...(input.allowedUnitCodes
        ? { allowedUnitCodesJson: JSON.stringify(input.allowedUnitCodes) }
        : {}),
      isPublic: input.isPublic,
      status: input.status,
      effectiveFrom,
    };
    await this.client.upsertEntity(entity, "Replace");
    return toAdmin(entity);
  }
}

function toAdmin(entity: CommodityTableEntity): AdminCommodity {
  return {
    code: entity.rowKey,
    category: entity.category,
    name: { en: entity.nameEn, fr: entity.nameFr },
    ...(entity.iconName ? { iconName: entity.iconName } : {}),
    ...(entity.defaultUnitCode ? { defaultUnitCode: entity.defaultUnitCode } : {}),
    allowedUnitCodes: entity.allowedUnitCodesJson
      ? (JSON.parse(entity.allowedUnitCodesJson) as string[])
      : [],
    isPublic: entity.isPublic,
    status: entity.status,
    effectiveFrom: entity.effectiveFrom,
  };
}

export function createCommodityRepository(): CommodityRepository {
  if (!hasTableStorageConfiguration()) {
    return new InMemoryCommodityRepository();
  }

  const tableName = process.env.AZURE_STORAGE_COMMODITIES_TABLE ?? "ReferenceData";
  const logger = new Logger("CommodityRepository");
  logger.log(`Using Azure Table Storage table ${tableName}`);

  return new AzureTableCommodityRepository(createTableClient(tableName));
}