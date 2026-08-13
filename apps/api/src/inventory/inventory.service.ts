import { authorize, type PermissionAction } from "@bordchamp/authz";
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
  InventoryConflictError,
  type CreateLotInput,
  type InventoryLot,
  type InventoryRepository,
  type LotQuantity,
} from "./inventory.repository.js";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organizations/organization.repository.js";
import {
  COMMODITY_REPOSITORY,
  type CommodityRepository,
} from "../reference-data/commodity.repository.js";
import {
  PRODUCTION_UNIT_REPOSITORY,
  type ProductionUnitRepository,
} from "../production-units/production-unit.repository.js";

@Injectable()
export class InventoryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventory: InventoryRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(COMMODITY_REPOSITORY)
    private readonly commodities: CommodityRepository,
    @Inject(PRODUCTION_UNIT_REPOSITORY)
    private readonly productionUnits: ProductionUnitRepository,
  ) {}

  async create(
    actor: ActorContext,
    input: Omit<CreateLotInput, "actorUserId">,
  ): Promise<InventoryLot> {
    const owner = await this.organizations.get(input.ownerOrganizationId);
    if (owner === undefined) {
      throw new BadRequestException("Owner organization not found");
    }
    this.assertAllowed(
      "inventory.lot.create",
      actor,
      owner.status,
      input.ownerOrganizationId,
    );
    const commodity = (await this.commodities.listPublicActive()).find(
      (candidate) => candidate.code === input.commodityCode,
    );
    if (commodity === undefined) {
      throw new BadRequestException("Commodity is not active");
    }
    if (commodity.category !== input.category) {
      throw new BadRequestException("Commodity category does not match lot category");
    }
    if (input.productionUnitId !== undefined) {
      const unit = await this.productionUnits.get(input.productionUnitId);
      if (unit === undefined || unit.status !== "active") {
        throw new BadRequestException("Production unit is not active");
      }
      if (unit.ownerOrganizationId !== input.ownerOrganizationId) {
        throw new BadRequestException("Production unit belongs to another organization");
      }
      if (unit.supportedCategory !== input.category) {
        throw new BadRequestException("Production unit does not support the lot category");
      }
    }
    return this.inventory.create({ ...input, actorUserId: actor.userId });
  }

  async get(actor: ActorContext, id: string): Promise<InventoryLot> {
    const lot = await this.requireLot(id);
    this.assertAllowed(
      "inventory.lot.view",
      actor,
      policyStatus(lot.status),
      lot.ownerOrganizationId,
    );
    return lot;
  }

  async updateQuantity(
    actor: ActorContext,
    id: string,
    quantity: LotQuantity,
    etag: string,
  ): Promise<InventoryLot> {
    const lot = await this.requireLot(id);
    this.assertAllowed(
      "inventory.lot.update",
      actor,
      policyStatus(lot.status),
      lot.ownerOrganizationId,
    );
    return this.mapConflict(() =>
      this.inventory.updateQuantity(id, quantity, etag, actor.userId),
    );
  }

  async markAvailable(
    actor: ActorContext,
    id: string,
    etag: string,
  ): Promise<InventoryLot> {
    const lot = await this.requireLot(id);
    if (lot.status !== "draft") {
      throw new BadRequestException("Only a draft lot can be marked available");
    }
    this.assertAllowed(
      "inventory.lot.update",
      actor,
      policyStatus(lot.status),
      lot.ownerOrganizationId,
    );
    return this.mapConflict(() =>
      this.inventory.markAvailable(id, etag, actor.userId),
    );
  }

  async quarantine(
    actor: ActorContext,
    id: string,
    reason: string,
    etag: string,
    assignmentId?: string,
  ): Promise<InventoryLot> {
    const lot = await this.requireLot(id);
    this.assertAllowed(
      "inventory.lot.quarantine",
      actor,
      policyStatus(lot.status),
      lot.ownerOrganizationId,
      assignmentId,
    );
    return this.mapConflict(() =>
      this.inventory.quarantine(id, reason, etag, actor.userId),
    );
  }

  async deactivate(
    actor: ActorContext,
    id: string,
    reason: string,
    etag: string,
  ): Promise<InventoryLot> {
    const lot = await this.requireLot(id);
    this.assertAllowed(
      "entity.deactivate",
      actor,
      policyStatus(lot.status),
      lot.ownerOrganizationId,
    );
    return this.mapConflict(() =>
      this.inventory.deactivate(id, reason, etag, actor.userId),
    );
  }

  private async requireLot(id: string): Promise<InventoryLot> {
    const lot = await this.inventory.get(id);
    if (lot === undefined) {
      throw new NotFoundException("Inventory lot not found");
    }
    return lot;
  }

  private assertAllowed(
    action: PermissionAction,
    actor: ActorContext,
    status: EntityStatus,
    organizationId: string,
    assignmentId?: string,
  ): void {
    const decision = authorize({
      action,
      actor,
      entityStatus: status,
      resourceOrganizationId: organizationId,
      ...(assignmentId === undefined ? {} : { assignmentId }),
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }
  }

  private async mapConflict(
    operation: () => Promise<InventoryLot>,
  ): Promise<InventoryLot> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof InventoryConflictError) {
        throw new ConflictException("The lot changed; refresh and retry");
      }
      throw error;
    }
  }
}

function policyStatus(status: InventoryLot["status"]): EntityStatus {
  if (status === "inactive") {
    return "inactive";
  }
  if (status === "sold") {
    return "inactive";
  }
  if (status === "quarantined") {
    return "suspended";
  }
  return "active";
}