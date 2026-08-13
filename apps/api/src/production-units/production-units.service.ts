import { authorize } from "@bordchamp/authz";
import type { ActorContext } from "@bordchamp/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organizations/organization.repository.js";
import {
  PRODUCTION_UNIT_REPOSITORY,
  ProductionUnitConflictError,
  type CreateProductionUnitInput,
  type ProductionUnit,
  type ProductionUnitRepository,
} from "./production-unit.repository.js";

@Injectable()
export class ProductionUnitsService {
  constructor(
    @Inject(PRODUCTION_UNIT_REPOSITORY)
    private readonly units: ProductionUnitRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
  ) {}

  async create(
    actor: ActorContext,
    input: Omit<CreateProductionUnitInput, "actorUserId">,
  ): Promise<ProductionUnit> {
    if (!supportsCategory(input.type, input.supportedCategory)) {
      throw new BadRequestException(
        "Production unit type does not support the selected category",
      );
    }
    const owner = await this.organizations.get(input.ownerOrganizationId);
    if (owner === undefined) {
      throw new BadRequestException("Owner organization not found");
    }
    this.assert(
      "productionUnit.create",
      actor,
      owner.status,
      input.ownerOrganizationId,
    );
    return this.units.create({ ...input, actorUserId: actor.userId });
  }

  async get(actor: ActorContext, id: string): Promise<ProductionUnit> {
    const unit = await this.requireUnit(id);
    this.assert(
      "productionUnit.view",
      actor,
      unit.status,
      unit.ownerOrganizationId,
    );
    return unit;
  }

  async deactivate(
    actor: ActorContext,
    id: string,
    reason: string,
    etag: string,
  ): Promise<ProductionUnit> {
    const unit = await this.requireUnit(id);
    this.assert("entity.deactivate", actor, unit.status, unit.ownerOrganizationId);
    try {
      return await this.units.deactivate(id, reason, etag, actor.userId);
    } catch (error: unknown) {
      if (error instanceof ProductionUnitConflictError) {
        throw new ConflictException("The production unit changed; refresh and retry");
      }
      throw error;
    }
  }

  private async requireUnit(id: string): Promise<ProductionUnit> {
    const unit = await this.units.get(id);
    if (unit === undefined) {
      throw new NotFoundException("Production unit not found");
    }
    return unit;
  }

  private assert(
    action: "productionUnit.create" | "productionUnit.view" | "entity.deactivate",
    actor: ActorContext,
    status: "active" | "inactive" | "windDown" | "suspended",
    organizationId: string,
  ): void {
    const decision = authorize({
      action,
      actor,
      entityStatus: status,
      resourceOrganizationId: organizationId,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }
  }
}

function supportsCategory(
  type: CreateProductionUnitInput["type"],
  category: CreateProductionUnitInput["supportedCategory"],
): boolean {
  if (type === "field" || type === "greenhouse") {
    return category === "crop";
  }
  if (type === "pond" || type === "tank" || type === "cage") {
    return category === "aquaculture";
  }
  if (
    type === "barn" ||
    type === "coop" ||
    type === "pen" ||
    type === "snailery"
  ) {
    return category === "liveAnimal";
  }
  return category === "animalProduct";
}