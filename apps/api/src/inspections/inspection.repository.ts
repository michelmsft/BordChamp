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

export const INSPECTION_REPOSITORY = Symbol("INSPECTION_REPOSITORY");

export type InspectionType =
  | "quality"
  | "sanitary"
  | "veterinary"
  | "aquacultureHealth"
  | "coldChain";
export type FindingResult = "pass" | "fail" | "notApplicable";

export interface InspectionFinding {
  readonly code: string;
  readonly result: FindingResult;
  readonly notes?: string;
}

export interface Inspection {
  readonly id: string;
  readonly lotId: string;
  readonly ownerOrganizationId: string;
  readonly type: InspectionType;
  readonly assignedInspectorUserId: string;
  readonly status: "assigned" | "finalized";
  readonly outcome?: "pass" | "fail";
  readonly gradeCode?: string;
  readonly certificateNumber?: string;
  readonly certificateValidUntil?: string;
  readonly findings?: readonly InspectionFinding[];
  readonly lotHoldApplied: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finalizedAt?: string;
  readonly etag: string;
}

export interface RequestInspectionInput {
  readonly lotId: string;
  readonly ownerOrganizationId: string;
  readonly type: InspectionType;
  readonly assignedInspectorUserId: string;
  readonly actorUserId: string;
}

export interface FinalizeInspectionInput {
  readonly outcome: "pass" | "fail";
  readonly gradeCode?: string;
  readonly certificateNumber: string;
  readonly certificateValidUntil?: string;
  readonly findings: readonly InspectionFinding[];
  readonly lotHoldApplied: boolean;
  readonly actorUserId: string;
}

export class InspectionConflictError extends Error {}

export interface InspectionRepository {
  create(input: RequestInspectionInput): Promise<Inspection>;
  get(id: string): Promise<Inspection | undefined>;
  finalize(
    id: string,
    input: FinalizeInspectionInput,
    etag: string,
  ): Promise<Inspection>;
}

interface InspectionEntity extends TableEntity {
  readonly lotId: string;
  readonly ownerOrganizationId: string;
  readonly type: InspectionType;
  readonly assignedInspectorUserId: string;
  readonly status: "assigned" | "finalized";
  readonly outcome?: "pass" | "fail";
  readonly gradeCode?: string;
  readonly certificateNumber?: string;
  readonly certificateValidUntil?: string;
  readonly findingsJson?: string;
  readonly lotHoldApplied: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finalizedAt?: string;
}

function toInspection(
  entity: InspectionEntity & { readonly etag?: string },
): Inspection {
  return {
    id: entity.partitionKey,
    lotId: entity.lotId,
    ownerOrganizationId: entity.ownerOrganizationId,
    type: entity.type,
    assignedInspectorUserId: entity.assignedInspectorUserId,
    status: entity.status,
    ...(entity.outcome === undefined ? {} : { outcome: entity.outcome }),
    ...(entity.gradeCode === undefined ? {} : { gradeCode: entity.gradeCode }),
    ...(entity.certificateNumber === undefined
      ? {}
      : { certificateNumber: entity.certificateNumber }),
    ...(entity.certificateValidUntil === undefined
      ? {}
      : { certificateValidUntil: entity.certificateValidUntil }),
    ...(entity.findingsJson === undefined
      ? {}
      : {
          findings: JSON.parse(entity.findingsJson) as readonly InspectionFinding[],
        }),
    lotHoldApplied: entity.lotHoldApplied,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    ...(entity.finalizedAt === undefined
      ? {}
      : { finalizedAt: entity.finalizedAt }),
    etag: entity.etag ?? "",
  };
}

function profile(inspection: Inspection): InspectionEntity {
  return {
    partitionKey: inspection.id,
    rowKey: "PROFILE",
    lotId: inspection.lotId,
    ownerOrganizationId: inspection.ownerOrganizationId,
    type: inspection.type,
    assignedInspectorUserId: inspection.assignedInspectorUserId,
    status: inspection.status,
    ...(inspection.outcome === undefined ? {} : { outcome: inspection.outcome }),
    ...(inspection.gradeCode === undefined
      ? {}
      : { gradeCode: inspection.gradeCode }),
    ...(inspection.certificateNumber === undefined
      ? {}
      : { certificateNumber: inspection.certificateNumber }),
    ...(inspection.certificateValidUntil === undefined
      ? {}
      : { certificateValidUntil: inspection.certificateValidUntil }),
    ...(inspection.findings === undefined
      ? {}
      : { findingsJson: JSON.stringify(inspection.findings) }),
    lotHoldApplied: inspection.lotHoldApplied,
    createdAt: inspection.createdAt,
    updatedAt: inspection.updatedAt,
    ...(inspection.finalizedAt === undefined
      ? {}
      : { finalizedAt: inspection.finalizedAt }),
  };
}

function event(
  inspectionId: string,
  eventType: string,
  actorUserId: string,
  occurredAt: string,
  details: string,
): TableEntity {
  return {
    partitionKey: inspectionId,
    rowKey: `EVENT:${occurredAt}:${randomUUID()}`,
    eventType,
    actorUserId,
    occurredAt,
    details,
  };
}

export class InMemoryInspectionRepository implements InspectionRepository {
  private readonly inspections = new Map<string, Inspection>();
  private version = 0;

  async create(input: RequestInspectionInput): Promise<Inspection> {
    const now = new Date().toISOString();
    const inspection: Inspection = {
      id: randomUUID(),
      lotId: input.lotId,
      ownerOrganizationId: input.ownerOrganizationId,
      type: input.type,
      assignedInspectorUserId: input.assignedInspectorUserId,
      status: "assigned",
      lotHoldApplied: false,
      createdAt: now,
      updatedAt: now,
      etag: this.nextEtag(),
    };
    this.inspections.set(inspection.id, inspection);
    return inspection;
  }

  async get(id: string): Promise<Inspection | undefined> {
    return this.inspections.get(id);
  }

  async finalize(
    id: string,
    input: FinalizeInspectionInput,
    etag: string,
  ): Promise<Inspection> {
    const current = this.inspections.get(id);
    if (current === undefined) {
      throw new Error("Inspection not found");
    }
    if (current.etag !== etag) {
      throw new InspectionConflictError(id);
    }
    const now = new Date().toISOString();
    const finalized: Inspection = {
      ...current,
      status: "finalized",
      outcome: input.outcome,
      ...(input.gradeCode === undefined ? {} : { gradeCode: input.gradeCode }),
      certificateNumber: input.certificateNumber,
      ...(input.certificateValidUntil === undefined
        ? {}
        : { certificateValidUntil: input.certificateValidUntil }),
      findings: input.findings,
      lotHoldApplied: input.lotHoldApplied,
      updatedAt: now,
      finalizedAt: now,
      etag: this.nextEtag(),
    };
    this.inspections.set(id, finalized);
    return finalized;
  }

  private nextEtag(): string {
    this.version += 1;
    return `W/\"${this.version}\"`;
  }
}

export class AzureTableInspectionRepository implements InspectionRepository {
  constructor(private readonly inspections: TableClient) {}

  async create(input: RequestInspectionInput): Promise<Inspection> {
    const now = new Date().toISOString();
    const inspection: Inspection = {
      id: randomUUID(),
      lotId: input.lotId,
      ownerOrganizationId: input.ownerOrganizationId,
      type: input.type,
      assignedInspectorUserId: input.assignedInspectorUserId,
      status: "assigned",
      lotHoldApplied: false,
      createdAt: now,
      updatedAt: now,
      etag: "",
    };
    const transaction = new TableTransaction();
    transaction.createEntity(profile(inspection));
    transaction.createEntity(
      event(
        inspection.id,
        "inspection.requested",
        input.actorUserId,
        now,
        input.lotId,
      ),
    );
    await this.inspections.submitTransaction(transaction.actions);
    return this.requireInspection(inspection.id);
  }

  async get(id: string): Promise<Inspection | undefined> {
    try {
      return toInspection(
        await this.inspections.getEntity<InspectionEntity>(id, "PROFILE"),
      );
    } catch (error: unknown) {
      if (isStatusCode(error, 404)) {
        return undefined;
      }
      throw error;
    }
  }

  async finalize(
    id: string,
    input: FinalizeInspectionInput,
    etag: string,
  ): Promise<Inspection> {
    const current = await this.requireInspection(id);
    const now = new Date().toISOString();
    const finalized: Inspection = {
      ...current,
      status: "finalized",
      outcome: input.outcome,
      ...(input.gradeCode === undefined ? {} : { gradeCode: input.gradeCode }),
      certificateNumber: input.certificateNumber,
      ...(input.certificateValidUntil === undefined
        ? {}
        : { certificateValidUntil: input.certificateValidUntil }),
      findings: input.findings,
      lotHoldApplied: input.lotHoldApplied,
      updatedAt: now,
      finalizedAt: now,
    };
    const transaction = new TableTransaction();
    transaction.updateEntity(profile(finalized), "Replace", { etag });
    transaction.createEntity(
      event(id, "inspection.finalized", input.actorUserId, now, input.outcome),
    );
    try {
      await this.inspections.submitTransaction(transaction.actions);
    } catch (error: unknown) {
      if (isStatusCode(error, 409) || isStatusCode(error, 412)) {
        throw new InspectionConflictError(id);
      }
      throw error;
    }
    return this.requireInspection(id);
  }

  private async requireInspection(id: string): Promise<Inspection> {
    const inspection = await this.get(id);
    if (inspection === undefined) {
      throw new Error("Inspection not found");
    }
    return inspection;
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

export function createInspectionRepository(): InspectionRepository {
  if (!hasTableStorageConfiguration()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Azure Table Storage configuration is required in production");
    }
    return new InMemoryInspectionRepository();
  }
  return new AzureTableInspectionRepository(
    createTableClient(
      process.env.AZURE_STORAGE_INSPECTIONS_TABLE ?? "Inspections",
    ),
  );
}