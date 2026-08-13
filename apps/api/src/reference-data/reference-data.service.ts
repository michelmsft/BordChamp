import { authorize } from "@bordchamp/authz";
import type { ActorContext } from "@bordchamp/domain";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";

import {
  COMMODITY_REPOSITORY,
  type AdminCommodity,
  type CommodityRepository,
  type PublicCommodity,
  type UpsertCommodityInput,
} from "./commodity.repository.js";
import {
  UNIT_REPOSITORY,
  type Unit,
  type UnitRepository,
  type UpsertUnitInput,
} from "./unit.repository.js";
import {
  INSPECTION_SCHEME_REPOSITORY,
  type InspectionScheme,
  type InspectionSchemeRepository,
  type UpsertInspectionSchemeInput,
} from "./inspection-scheme.repository.js";

export type { PublicCommodity, AdminCommodity } from "./commodity.repository.js";
export type { Unit } from "./unit.repository.js";
export type { InspectionScheme } from "./inspection-scheme.repository.js";

@Injectable()
export class ReferenceDataService {
  constructor(
    @Inject(COMMODITY_REPOSITORY) private readonly commodities: CommodityRepository,
    @Inject(UNIT_REPOSITORY) private readonly units: UnitRepository,
    @Inject(INSPECTION_SCHEME_REPOSITORY) private readonly schemes: InspectionSchemeRepository,
  ) {}

  async listPublicCommodities(): Promise<readonly PublicCommodity[]> {
    const decision = authorize({ action: "referenceData.view", entityStatus: "active" });
    if (!decision.allowed) throw new ForbiddenException(decision.reason);
    return this.commodities.listPublicActive();
  }

  async listActiveUnits(): Promise<readonly Unit[]> {
    const decision = authorize({ action: "referenceData.view", entityStatus: "active" });
    if (!decision.allowed) throw new ForbiddenException(decision.reason);
    return this.units.listActive();
  }

  async listActiveSchemes(): Promise<readonly InspectionScheme[]> {
    const decision = authorize({ action: "referenceData.view", entityStatus: "active" });
    if (!decision.allowed) throw new ForbiddenException(decision.reason);
    return this.schemes.listActive();
  }

  async listAdminCommodities(actor: ActorContext): Promise<readonly AdminCommodity[]> {
    this.requireAdmin(actor);
    return this.commodities.listAll();
  }

  async upsertCommodity(actor: ActorContext, input: UpsertCommodityInput): Promise<AdminCommodity> {
    this.requireAdmin(actor);
    return this.commodities.upsert(input);
  }

  async listAdminUnits(actor: ActorContext): Promise<readonly Unit[]> {
    this.requireAdmin(actor);
    return this.units.listAll();
  }

  async upsertUnit(actor: ActorContext, input: UpsertUnitInput): Promise<Unit> {
    this.requireAdmin(actor);
    return this.units.upsert(input);
  }

  async listAdminSchemes(actor: ActorContext): Promise<readonly InspectionScheme[]> {
    this.requireAdmin(actor);
    return this.schemes.listAll();
  }

  async upsertScheme(actor: ActorContext, input: UpsertInspectionSchemeInput): Promise<InspectionScheme> {
    this.requireAdmin(actor);
    return this.schemes.upsert(input);
  }

  private requireAdmin(actor: ActorContext): void {
    const decision = authorize({ action: "referenceData.manage", actor, entityStatus: "active" });
    if (!decision.allowed) throw new ForbiddenException(decision.reason);
  }
}