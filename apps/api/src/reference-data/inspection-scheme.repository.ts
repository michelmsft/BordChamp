import { TableClient, type TableEntity } from "@azure/data-tables";
import { Logger } from "@nestjs/common";

import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";
import type { InspectionType } from "../inspections/inspection.repository.js";

export const INSPECTION_SCHEME_REPOSITORY = Symbol("INSPECTION_SCHEME_REPOSITORY");

export type MetricResultKind = "percentage" | "passFail" | "measurement" | "qualitative";
export type StandardOperator = "gte" | "lte" | "range" | "equals" | "qualitative";
export type SchemeStatus = "active" | "suspended" | "inactive";

export interface InspectionMetric {
  readonly code: string;
  readonly label: { readonly en: string; readonly fr: string };
  readonly whatIsChecked: { readonly en: string; readonly fr: string };
  readonly resultKind: MetricResultKind;
  readonly standard: {
    readonly operator: StandardOperator;
    readonly threshold?: number;
    readonly min?: number;
    readonly max?: number;
    readonly unitCode?: string;
    readonly text?: string;
  };
  readonly mandatory: boolean;
  readonly weight?: number;
}

export interface InspectionGrade {
  readonly code: string;
  readonly label: { readonly en: string; readonly fr: string };
  readonly rank: number;
  readonly minScore?: number;
  readonly requiredPasses?: readonly string[];
}

export interface InspectionScheme {
  readonly commodityCode: string;
  readonly type: InspectionType;
  readonly label: { readonly en: string; readonly fr: string };
  readonly samplingHint?: string;
  readonly metrics: readonly InspectionMetric[];
  readonly grades: readonly InspectionGrade[];
  readonly status: SchemeStatus;
  readonly updatedAt: string;
}

export interface UpsertInspectionSchemeInput {
  readonly commodityCode: string;
  readonly type: InspectionType;
  readonly labelEn: string;
  readonly labelFr: string;
  readonly samplingHint?: string;
  readonly metrics: readonly InspectionMetric[];
  readonly grades: readonly InspectionGrade[];
  readonly status: SchemeStatus;
}

export interface InspectionSchemeRepository {
  listActive(): Promise<readonly InspectionScheme[]>;
  listAll(): Promise<readonly InspectionScheme[]>;
  get(commodityCode: string, type: InspectionType): Promise<InspectionScheme | undefined>;
  upsert(input: UpsertInspectionSchemeInput): Promise<InspectionScheme>;
}

interface SchemeEntity extends TableEntity {
  readonly commodityCode: string;
  readonly type: InspectionType;
  readonly labelEn: string;
  readonly labelFr: string;
  readonly samplingHint?: string;
  readonly metricsJson: string;
  readonly gradesJson: string;
  readonly status: SchemeStatus;
  readonly updatedAt: string;
}

const SCHEME_PARTITION = "INSPECTION_SCHEME";

function rowKeyFor(commodityCode: string, type: InspectionType): string {
  return `${commodityCode}:${type}`;
}

function toEntity(input: UpsertInspectionSchemeInput, now: string): SchemeEntity {
  return {
    partitionKey: SCHEME_PARTITION,
    rowKey: rowKeyFor(input.commodityCode, input.type),
    commodityCode: input.commodityCode,
    type: input.type,
    labelEn: input.labelEn,
    labelFr: input.labelFr,
    ...(input.samplingHint ? { samplingHint: input.samplingHint } : {}),
    metricsJson: JSON.stringify(input.metrics),
    gradesJson: JSON.stringify(input.grades),
    status: input.status,
    updatedAt: now,
  };
}

function fromEntity(entity: SchemeEntity): InspectionScheme {
  return {
    commodityCode: entity.commodityCode,
    type: entity.type,
    label: { en: entity.labelEn, fr: entity.labelFr },
    ...(entity.samplingHint ? { samplingHint: entity.samplingHint } : {}),
    metrics: JSON.parse(entity.metricsJson) as readonly InspectionMetric[],
    grades: JSON.parse(entity.gradesJson) as readonly InspectionGrade[],
    status: entity.status,
    updatedAt: entity.updatedAt,
  };
}

const seedSchemes: readonly UpsertInspectionSchemeInput[] = [
  {
    commodityCode: "TOMATO",
    type: "quality",
    labelEn: "Tomato quality",
    labelFr: "Qualité tomate",
    samplingHint: "Random sample of 50 tomatoes",
    metrics: [
      { code: "MATURITY", label: { en: "Maturity", fr: "Maturité" }, whatIsChecked: { en: "Ripeness/color", fr: "Maturité/couleur" }, resultKind: "percentage", standard: { operator: "gte", threshold: 80 }, mandatory: true },
      { code: "SIZE_UNIFORMITY", label: { en: "Size uniformity", fr: "Uniformité de taille" }, whatIsChecked: { en: "Consistency of tomato size", fr: "Consistance de la taille" }, resultKind: "percentage", standard: { operator: "gte", threshold: 85 }, mandatory: true },
      { code: "FIRMNESS", label: { en: "Firmness", fr: "Fermeté" }, whatIsChecked: { en: "Resistance to handling", fr: "Résistance à la manipulation" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "Firm, not soft" }, mandatory: true },
      { code: "PHYSICAL_DAMAGE", label: { en: "Physical damage", fr: "Dommage physique" }, whatIsChecked: { en: "Cuts, bruises, cracks", fr: "Coupures, meurtrissures, fissures" }, resultKind: "percentage", standard: { operator: "lte", threshold: 5 }, mandatory: true },
      { code: "PEST_DAMAGE", label: { en: "Pest/disease damage", fr: "Dommages parasitaires" }, whatIsChecked: { en: "Visible insects, lesions, rot", fr: "Insectes, lésions, pourriture" }, resultKind: "percentage", standard: { operator: "lte", threshold: 2 }, mandatory: true },
      { code: "CLEANLINESS", label: { en: "Cleanliness", fr: "Propreté" }, whatIsChecked: { en: "Soil/foreign material", fr: "Terre/corps étrangers" }, resultKind: "percentage", standard: { operator: "gte", threshold: 95 }, mandatory: true },
      { code: "SHAPE", label: { en: "Shape", fr: "Forme" }, whatIsChecked: { en: "Normal shape for variety", fr: "Forme conforme à la variété" }, resultKind: "percentage", standard: { operator: "gte", threshold: 85 }, mandatory: false },
      { code: "DECAY", label: { en: "Decay", fr: "Pourriture" }, whatIsChecked: { en: "Rotten tomatoes", fr: "Tomates pourries" }, resultKind: "percentage", standard: { operator: "lte", threshold: 1 }, mandatory: true },
    ],
    grades: [
      { code: "A", label: { en: "Grade A", fr: "Classe A" }, rank: 1, minScore: 90, requiredPasses: ["FIRMNESS"] },
      { code: "B", label: { en: "Grade B", fr: "Classe B" }, rank: 2, minScore: 75 },
      { code: "C", label: { en: "Grade C", fr: "Classe C" }, rank: 3, minScore: 60 },
    ],
    status: "active",
  },
  {
    commodityCode: "BROILER_CHICKEN",
    type: "veterinary",
    labelEn: "Live broiler inspection",
    labelFr: "Inspection poulet vivant",
    samplingHint: "Sample of 50 birds",
    metrics: [
      { code: "AVG_LIVE_WEIGHT", label: { en: "Average live weight", fr: "Poids vif moyen" }, whatIsChecked: { en: "Weight per bird", fr: "Poids par oiseau" }, resultKind: "measurement", standard: { operator: "range", min: 1.8, max: 2.5, unitCode: "KG" }, mandatory: true },
      { code: "WEIGHT_UNIFORMITY", label: { en: "Weight uniformity", fr: "Uniformité de poids" }, whatIsChecked: { en: "Birds within target range", fr: "Oiseaux dans la fourchette" }, resultKind: "percentage", standard: { operator: "gte", threshold: 85 }, mandatory: true },
      { code: "GENERAL_HEALTH", label: { en: "General health", fr: "Santé générale" }, whatIsChecked: { en: "Signs of disease", fr: "Signes de maladie" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "No significant symptoms" }, mandatory: true },
      { code: "MORTALITY", label: { en: "Mortality", fr: "Mortalité" }, whatIsChecked: { en: "Dead birds in lot", fr: "Oiseaux morts dans le lot" }, resultKind: "percentage", standard: { operator: "lte", threshold: 1 }, mandatory: true },
      { code: "PHYSICAL_CONDITION", label: { en: "Physical condition", fr: "État physique" }, whatIsChecked: { en: "Injuries/deformities", fr: "Blessures/déformations" }, resultKind: "percentage", standard: { operator: "lte", threshold: 3 }, mandatory: true },
      { code: "PLUMAGE", label: { en: "Plumage/skin", fr: "Plumage/peau" }, whatIsChecked: { en: "Visible abnormalities", fr: "Anomalies visibles" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "Good condition" }, mandatory: true },
      { code: "MOBILITY", label: { en: "Mobility", fr: "Mobilité" }, whatIsChecked: { en: "Ability to stand/walk normally", fr: "Capacité à se tenir/marcher" }, resultKind: "percentage", standard: { operator: "gte", threshold: 95 }, mandatory: true },
      { code: "CLEANLINESS", label: { en: "Cleanliness", fr: "Propreté" }, whatIsChecked: { en: "Excessive fecal contamination", fr: "Contamination fécale excessive" }, resultKind: "percentage", standard: { operator: "lte", threshold: 5 }, mandatory: false },
    ],
    grades: [
      { code: "A", label: { en: "Grade A", fr: "Classe A" }, rank: 1, minScore: 90, requiredPasses: ["GENERAL_HEALTH", "MORTALITY"] },
      { code: "B", label: { en: "Grade B", fr: "Classe B" }, rank: 2, minScore: 75 },
      { code: "C", label: { en: "Grade C", fr: "Classe C" }, rank: 3, minScore: 60 },
    ],
    status: "active",
  },
  {
    commodityCode: "TILAPIA",
    type: "aquacultureHealth",
    labelEn: "Fresh tilapia inspection",
    labelFr: "Inspection tilapia frais",
    samplingHint: "Random sample of 40 fish",
    metrics: [
      { code: "AVG_WEIGHT", label: { en: "Average weight", fr: "Poids moyen" }, whatIsChecked: { en: "Weight per fish", fr: "Poids par poisson" }, resultKind: "measurement", standard: { operator: "range", min: 500, max: 800, unitCode: "G" }, mandatory: true },
      { code: "SIZE_UNIFORMITY", label: { en: "Size uniformity", fr: "Uniformité de taille" }, whatIsChecked: { en: "Fish within declared size class", fr: "Poissons dans la classe déclarée" }, resultKind: "percentage", standard: { operator: "gte", threshold: 85 }, mandatory: true },
      { code: "EYE_APPEARANCE", label: { en: "Eye appearance", fr: "Aspect des yeux" }, whatIsChecked: { en: "Clear/bright vs cloudy/sunken", fr: "Clairs/brillants vs troubles" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "Clear and bright" }, mandatory: true },
      { code: "GILLS", label: { en: "Gills", fr: "Branchies" }, whatIsChecked: { en: "Color and condition", fr: "Couleur et état" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "Bright red/pink" }, mandatory: true },
      { code: "ODOR", label: { en: "Odor", fr: "Odeur" }, whatIsChecked: { en: "Fresh vs abnormal odor", fr: "Fraîche vs anormale" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "Fresh/mild" }, mandatory: true },
      { code: "FLESH_FIRMNESS", label: { en: "Flesh firmness", fr: "Fermeté de la chair" }, whatIsChecked: { en: "Elasticity/firmness", fr: "Élasticité/fermeté" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "Firm" }, mandatory: true },
      { code: "SKIN_SCALES", label: { en: "Skin/scales", fr: "Peau/écailles" }, whatIsChecked: { en: "Damage and discoloration", fr: "Dommages et décoloration" }, resultKind: "percentage", standard: { operator: "lte", threshold: 5 }, mandatory: true },
      { code: "PHYSICAL_DAMAGE", label: { en: "Physical damage", fr: "Dommage physique" }, whatIsChecked: { en: "Cuts/bruising", fr: "Coupures/meurtrissures" }, resultKind: "percentage", standard: { operator: "lte", threshold: 3 }, mandatory: true },
      { code: "TEMPERATURE", label: { en: "Temperature", fr: "Température" }, whatIsChecked: { en: "Cold-chain compliance", fr: "Conformité chaîne du froid" }, resultKind: "measurement", standard: { operator: "lte", threshold: 4, unitCode: "CELSIUS" }, mandatory: true },
      { code: "PARASITES", label: { en: "Parasites/disease", fr: "Parasites/maladie" }, whatIsChecked: { en: "Visible abnormalities", fr: "Anomalies visibles" }, resultKind: "qualitative", standard: { operator: "qualitative", text: "None detected" }, mandatory: true },
    ],
    grades: [
      { code: "A", label: { en: "Grade A", fr: "Classe A" }, rank: 1, minScore: 90, requiredPasses: ["EYE_APPEARANCE", "GILLS", "ODOR", "PARASITES"] },
      { code: "B", label: { en: "Grade B", fr: "Classe B" }, rank: 2, minScore: 75 },
      { code: "C", label: { en: "Grade C", fr: "Classe C" }, rank: 3, minScore: 60 },
    ],
    status: "active",
  },
];

export class InMemoryInspectionSchemeRepository implements InspectionSchemeRepository {
  private readonly store = new Map<string, InspectionScheme>();

  constructor() {
    const now = new Date().toISOString();
    for (const seed of seedSchemes) {
      const scheme = fromEntity(toEntity(seed, now));
      this.store.set(rowKeyFor(scheme.commodityCode, scheme.type), scheme);
    }
  }

  async listActive(): Promise<readonly InspectionScheme[]> {
    return [...this.store.values()].filter((s) => s.status === "active").sort(sortSchemes);
  }

  async listAll(): Promise<readonly InspectionScheme[]> {
    return [...this.store.values()].sort(sortSchemes);
  }

  async get(commodityCode: string, type: InspectionType): Promise<InspectionScheme | undefined> {
    return this.store.get(rowKeyFor(commodityCode, type));
  }

  async upsert(input: UpsertInspectionSchemeInput): Promise<InspectionScheme> {
    const scheme = fromEntity(toEntity(input, new Date().toISOString()));
    this.store.set(rowKeyFor(scheme.commodityCode, scheme.type), scheme);
    return scheme;
  }
}

export class AzureTableInspectionSchemeRepository implements InspectionSchemeRepository {
  constructor(private readonly client: TableClient) {}

  async listActive(): Promise<readonly InspectionScheme[]> {
    return (await this.listAll()).filter((s) => s.status === "active");
  }

  async listAll(): Promise<readonly InspectionScheme[]> {
    const items: InspectionScheme[] = [];
    const entities = this.client.listEntities<SchemeEntity>({
      queryOptions: { filter: `PartitionKey eq '${SCHEME_PARTITION}'` },
    });
    for await (const entity of entities) items.push(fromEntity(entity));
    return items.sort(sortSchemes);
  }

  async get(commodityCode: string, type: InspectionType): Promise<InspectionScheme | undefined> {
    try {
      const entity = await this.client.getEntity<SchemeEntity>(SCHEME_PARTITION, rowKeyFor(commodityCode, type));
      return fromEntity(entity);
    } catch {
      return undefined;
    }
  }

  async upsert(input: UpsertInspectionSchemeInput): Promise<InspectionScheme> {
    const entity = toEntity(input, new Date().toISOString());
    await this.client.upsertEntity(entity, "Replace");
    return fromEntity(entity);
  }
}

function sortSchemes(a: InspectionScheme, b: InspectionScheme): number {
  return a.commodityCode === b.commodityCode
    ? a.type.localeCompare(b.type)
    : a.commodityCode.localeCompare(b.commodityCode);
}

export function createInspectionSchemeRepository(): InspectionSchemeRepository {
  if (!hasTableStorageConfiguration()) return new InMemoryInspectionSchemeRepository();
  const tableName = process.env.AZURE_STORAGE_COMMODITIES_TABLE ?? "ReferenceData";
  new Logger("InspectionSchemeRepository").log(`Using Azure Table Storage table ${tableName}`);
  return new AzureTableInspectionSchemeRepository(createTableClient(tableName));
}
