import type { TableEntity } from "@azure/data-tables";

import { createTableClient } from "./table-client.js";

const tableNames = {
  referenceData:
    process.env.AZURE_STORAGE_COMMODITIES_TABLE ?? "ReferenceData",
  organizations:
    process.env.AZURE_STORAGE_ORGANIZATIONS_TABLE ?? "Organizations",
  userDirectory:
    process.env.AZURE_STORAGE_USER_DIRECTORY_TABLE ?? "UserDirectory",
  inventory: process.env.AZURE_STORAGE_INVENTORY_TABLE ?? "Inventory",
  productionUnits:
    process.env.AZURE_STORAGE_PRODUCTION_UNITS_TABLE ?? "ProductionUnits",
  inspections: process.env.AZURE_STORAGE_INSPECTIONS_TABLE ?? "Inspections",
  warehouseReceipts:
    process.env.AZURE_STORAGE_WAREHOUSE_RECEIPTS_TABLE ?? "WarehouseReceipts",
  trading: process.env.AZURE_STORAGE_TRADING_TABLE ?? "Trading",
  settlements: process.env.AZURE_STORAGE_SETTLEMENTS_TABLE ?? "Settlements",
  deliveries: process.env.AZURE_STORAGE_DELIVERIES_TABLE ?? "Deliveries",
  disputes: process.env.AZURE_STORAGE_DISPUTES_TABLE ?? "Disputes",
  compliance: process.env.AZURE_STORAGE_COMPLIANCE_TABLE ?? "Compliance",
  lineage: process.env.AZURE_STORAGE_LINEAGE_TABLE ?? "Lineage",
  risk: process.env.AZURE_STORAGE_RISK_TABLE ?? "Risk",
  integrations: process.env.AZURE_STORAGE_INTEGRATIONS_TABLE ?? "Integrations",
} as const;

const commodities: readonly TableEntity[] = [
  commodity("TOMATO", "crop", "Tomato", "Tomate"),
  commodity("TILAPIA", "aquaculture", "Tilapia", "Tilapia"),
  commodity(
    "BROILER_CHICKEN",
    "liveAnimal",
    "Broiler chicken",
    "Poulet de chair",
  ),
  commodity(
    "TABLE_EGG",
    "animalProduct",
    "Table egg",
    "Oeuf de consommation",
  ),
];

async function bootstrap(): Promise<void> {
  const referenceData = createTableClient(tableNames.referenceData);
  const organizations = createTableClient(tableNames.organizations);
  const userDirectory = createTableClient(tableNames.userDirectory);
  const inventory = createTableClient(tableNames.inventory);
  const productionUnits = createTableClient(tableNames.productionUnits);
  const inspections = createTableClient(tableNames.inspections);
  const warehouseReceipts = createTableClient(tableNames.warehouseReceipts);
  const trading = createTableClient(tableNames.trading);
  const settlements = createTableClient(tableNames.settlements);
  const deliveries = createTableClient(tableNames.deliveries);
  const disputes = createTableClient(tableNames.disputes);
  const compliance = createTableClient(tableNames.compliance);
  const lineage = createTableClient(tableNames.lineage);
  const risk = createTableClient(tableNames.risk);
  const integrations = createTableClient(tableNames.integrations);

  await Promise.all([
    referenceData.createTable(),
    organizations.createTable(),
    userDirectory.createTable(),
    inventory.createTable(),
    productionUnits.createTable(),
    inspections.createTable(),
    warehouseReceipts.createTable(),
    trading.createTable(),
    settlements.createTable(),
    deliveries.createTable(),
    disputes.createTable(),
    compliance.createTable(),
    lineage.createTable(),
    risk.createTable(),
    integrations.createTable(),
  ]);

  await Promise.all(
    commodities.map((entity) => referenceData.upsertEntity(entity, "Replace")),
  );

  console.log(
    `Initialized ${Object.values(tableNames).join(", ")} and seeded ${commodities.length} commodities`,
  );
}

function commodity(
  code: string,
  category: string,
  nameEn: string,
  nameFr: string,
): TableEntity {
  return {
    partitionKey: "PUBLIC_COMMODITY",
    rowKey: code,
    category,
    nameEn,
    nameFr,
    isPublic: true,
    status: "active",
    effectiveFrom: "2026-08-12T00:00:00.000Z",
  };
}

void bootstrap();