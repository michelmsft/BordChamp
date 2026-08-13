import { authorize } from "@bordchamp/authz";
import type { ActorContext } from "@bordchamp/domain";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";

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

  async deleteUnit(actor: ActorContext, code: string): Promise<void> {
    this.requireAdmin(actor);
    const normalized = code.trim().toUpperCase();
    const [units, commodities, schemes] = await Promise.all([
      this.units.listAll(),
      this.commodities.listAll(),
      this.schemes.listAll(),
    ]);
    if (!units.some((unit) => unit.code === normalized)) throw new NotFoundException("Unit not found");
    const dependentUnit = units.find((unit) => unit.code !== normalized && unit.baseUnitCode === normalized);
    if (dependentUnit) throw new ConflictException(`Unit is used as the base unit by ${dependentUnit.code}`);
    const commodity = commodities.find((item) => item.defaultUnitCode === normalized || item.allowedUnitCodes.includes(normalized));
    if (commodity) throw new ConflictException(`Unit is used by product ${commodity.code}`);
    const scheme = schemes.find((item) => item.metrics.some((metric) => metric.standard.unitCode === normalized));
    if (scheme) throw new ConflictException(`Unit is used by control ${scheme.commodityCode}:${scheme.type}`);
    await this.units.delete(normalized);
  }

  async listAdminSchemes(actor: ActorContext): Promise<readonly InspectionScheme[]> {
    this.requireAdmin(actor);
    return this.schemes.listAll();
  }

  async upsertScheme(actor: ActorContext, input: UpsertInspectionSchemeInput): Promise<InspectionScheme> {
    this.requireAdmin(actor);
    return this.schemes.upsert(input);
  }

  async createScheme(actor: ActorContext, input: UpsertInspectionSchemeInput): Promise<InspectionScheme> {
    this.requireAdmin(actor);
    const existing = await this.schemes.get(input.commodityCode, input.type);
    if (existing) throw new ConflictException(`Control ${input.commodityCode}:${input.type} already exists`);
    return this.schemes.upsert(input);
  }

  private requireAdmin(actor: ActorContext): void {
    const decision = authorize({ action: "referenceData.manage", actor, entityStatus: "active" });
    if (!decision.allowed) throw new ForbiddenException(decision.reason);
  }
}