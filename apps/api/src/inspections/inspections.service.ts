import { authorize } from "@bordchamp/authz";
import type { ActorContext, EntityStatus } from "@bordchamp/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
  type LotStatus,
} from "../inventory/inventory.repository.js";
import { InventoryService } from "../inventory/inventory.service.js";
import {
  INSPECTION_REPOSITORY,
  InspectionConflictError,
  type FinalizeInspectionInput,
  type Inspection,
  type InspectionRepository,
  type RequestInspectionInput,
} from "./inspection.repository.js";

@Injectable()
export class InspectionsService {
  constructor(
    @Inject(INSPECTION_REPOSITORY)
    private readonly inspections: InspectionRepository,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepository,
    @Inject(InventoryService)
    private readonly inventory: InventoryService,
  ) {}

  async request(
    actor: ActorContext,
    input: Omit<RequestInspectionInput, "ownerOrganizationId" | "actorUserId">,
  ): Promise<Inspection> {
    const lot = await this.inventoryRepository.get(input.lotId);
    if (lot === undefined) {
      throw new NotFoundException("Inventory lot not found");
    }
    const decision = authorize({
      action: "inspection.request",
      actor,
      entityStatus: lotStatus(lot.status),
      resourceOrganizationId: lot.ownerOrganizationId,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }
    return this.inspections.create({
      ...input,
      ownerOrganizationId: lot.ownerOrganizationId,
      actorUserId: actor.userId,
    });
  }

  async get(actor: ActorContext, id: string): Promise<Inspection> {
    const inspection = await this.requireInspection(id);
    const scopedActor = withStoredAssignment(actor, inspection);
    const decision = authorize({
      action: "inspection.view",
      actor: scopedActor,
      entityStatus: inspectionStatus(inspection.status),
      resourceOrganizationId: inspection.ownerOrganizationId,
      assignmentId: inspection.id,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }
    return inspection;
  }

  async finalize(
    actor: ActorContext,
    id: string,
    input: Omit<FinalizeInspectionInput, "lotHoldApplied" | "actorUserId">,
    etag: string,
  ): Promise<Inspection> {
    const inspection = await this.requireInspection(id);
    if (inspection.status !== "assigned") {
      throw new BadRequestException("Finalized inspections are immutable");
    }
    const scopedActor = withStoredAssignment(actor, inspection);
    const decision = authorize({
      action: "inspection.submit",
      actor: scopedActor,
      entityStatus: "active",
      assignmentId: inspection.id,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }

    const hasFailedFinding = input.findings.some(
      (finding) => finding.result === "fail",
    );
    if (input.outcome === "pass" && hasFailedFinding) {
      throw new BadRequestException("A passing inspection cannot contain failed findings");
    }
    if (input.outcome === "fail" && !hasFailedFinding) {
      throw new BadRequestException("A failed inspection requires a failed finding");
    }

    let lotHoldApplied = false;
    if (input.outcome === "fail") {
      const lot = await this.inventoryRepository.get(inspection.lotId);
      if (lot === undefined || lot.status === "inactive") {
        throw new BadRequestException("The inspected lot is not active");
      }
      if (lot.status !== "quarantined") {
        await this.inventory.quarantine(
          scopedActor,
          lot.id,
          `Inspection ${inspection.id} failed`,
          lot.etag,
          inspection.id,
        );
      }
      lotHoldApplied = true;
    }

    try {
      return await this.inspections.finalize(
        id,
        { ...input, lotHoldApplied, actorUserId: actor.userId },
        etag,
      );
    } catch (error: unknown) {
      if (error instanceof InspectionConflictError) {
        throw new ConflictException("The inspection changed; refresh and retry");
      }
      throw error;
    }
  }

  private async requireInspection(id: string): Promise<Inspection> {
    const inspection = await this.inspections.get(id);
    if (inspection === undefined) {
      throw new NotFoundException("Inspection not found");
    }
    return inspection;
  }
}

function withStoredAssignment(
  actor: ActorContext,
  inspection: Inspection,
): ActorContext {
  if (inspection.assignedInspectorUserId !== actor.userId) {
    return actor;
  }
  return {
    ...actor,
    assignmentIds: [...actor.assignmentIds, inspection.id],
  };
}

function inspectionStatus(status: Inspection["status"]): EntityStatus {
  return status === "assigned" ? "active" : "inactive";
}

function lotStatus(status: LotStatus): EntityStatus {
  if (status === "quarantined") {
    return "suspended";
  }
  if (status === "inactive" || status === "sold") {
    return "inactive";
  }
  return "active";
}