import { BadRequestException, Body, Controller, Get, Inject, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";

import { RequestActorService } from "../identity/request-actor.service.js";
import type { InspectionType } from "../inspections/inspection.repository.js";
import type { CommodityCategory, CommodityStatus } from "./commodity.repository.js";
import type { InspectionGrade, InspectionMetric, MetricResultKind, SchemeStatus, StandardOperator } from "./inspection-scheme.repository.js";
import { ReferenceDataService } from "./reference-data.service.js";
import type { UnitDimension, UnitStatus } from "./unit.repository.js";

const categories: readonly CommodityCategory[] = ["crop", "aquaculture", "liveAnimal", "animalProduct"];
const commodityStatuses: readonly CommodityStatus[] = ["active", "suspended", "inactive"];
const dimensions: readonly UnitDimension[] = ["mass", "count", "volume", "length", "temperature"];
const unitStatuses: readonly UnitStatus[] = ["active", "suspended", "inactive"];
const inspectionTypes: readonly InspectionType[] = ["quality", "sanitary", "veterinary", "aquacultureHealth", "coldChain"];
const schemeStatuses: readonly SchemeStatus[] = ["active", "suspended", "inactive"];
const resultKinds: readonly MetricResultKind[] = ["percentage", "passFail", "measurement", "qualitative"];
const standardOperators: readonly StandardOperator[] = ["gte", "lte", "range", "equals", "qualitative"];

@Controller("v1/admin/reference-data")
export class ReferenceDataAdminController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(ReferenceDataService) private readonly referenceData: ReferenceDataService,
  ) {}

  @Get("commodities")
  async listCommodities(@Req() request: Request) {
    const actor = await this.actors.fromRequest(request);
    return { data: await this.referenceData.listAdminCommodities(actor) };
  }

  @Put("commodities/:code")
  async upsertCommodity(@Req() request: Request, @Param("code") code: string, @Body() body: unknown) {
    const actor = await this.actors.fromRequest(request);
    const iconName = optionalString(body, "iconName");
    const defaultUnitCode = optionalString(body, "defaultUnitCode");
    const record = await this.referenceData.upsertCommodity(actor, {
      code: normalizeCode(code),
      category: enumValue(body, "category", categories),
      nameEn: stringValue(body, "nameEn"),
      nameFr: stringValue(body, "nameFr"),
      ...(iconName ? { iconName } : {}),
      ...(defaultUnitCode ? { defaultUnitCode: defaultUnitCode.toUpperCase() } : {}),
      allowedUnitCodes: stringArray(body, "allowedUnitCodes").map((c) => c.toUpperCase()),
      isPublic: boolValue(body, "isPublic"),
      status: enumValue(body, "status", commodityStatuses),
    });
    return { data: record };
  }

  @Get("units")
  async listUnits(@Req() request: Request) {
    const actor = await this.actors.fromRequest(request);
    return { data: await this.referenceData.listAdminUnits(actor) };
  }

  @Put("units/:code")
  async upsertUnit(@Req() request: Request, @Param("code") code: string, @Body() body: unknown) {
    const actor = await this.actors.fromRequest(request);
    const baseUnitCode = optionalString(body, "baseUnitCode");
    const factorToBase = optionalNumber(body, "factorToBase");
    const record = await this.referenceData.upsertUnit(actor, {
      code: normalizeCode(code),
      labelEn: stringValue(body, "labelEn"),
      labelFr: stringValue(body, "labelFr"),
      dimension: enumValue(body, "dimension", dimensions),
      ...(baseUnitCode ? { baseUnitCode: baseUnitCode.toUpperCase() } : {}),
      ...(factorToBase !== undefined ? { factorToBase } : {}),
      scale: integer(body, "scale"),
      status: enumValue(body, "status", unitStatuses),
    });
    return { data: record };
  }

  @Get("inspection-schemes")
  async listSchemes(@Req() request: Request) {
    const actor = await this.actors.fromRequest(request);
    return { data: await this.referenceData.listAdminSchemes(actor) };
  }

  @Put("inspection-schemes/:commodityCode/:type")
  async upsertScheme(
    @Req() request: Request,
    @Param("commodityCode") commodityCode: string,
    @Param("type") type: string,
    @Body() body: unknown,
  ) {
    const actor = await this.actors.fromRequest(request);
    const samplingHint = optionalString(body, "samplingHint");
    const record = await this.referenceData.upsertScheme(actor, {
      commodityCode: normalizeCode(commodityCode),
      type: assertEnum(type, inspectionTypes, "type"),
      labelEn: stringValue(body, "labelEn"),
      labelFr: stringValue(body, "labelFr"),
      ...(samplingHint ? { samplingHint } : {}),
      metrics: readMetrics(body),
      grades: readGrades(body),
      status: enumValue(body, "status", schemeStatuses),
    });
    return { data: record };
  }
}

function readMetrics(body: unknown): readonly InspectionMetric[] {
  const array = arrayValue(body, "metrics");
  return array.map((raw, index) => {
    const item = expectObject(raw, `metrics[${index}]`);
    const label = expectObject(item.label, `metrics[${index}].label`);
    const check = expectObject(item.whatIsChecked, `metrics[${index}].whatIsChecked`);
    const standard = expectObject(item.standard, `metrics[${index}].standard`);
    const unitCode = optionalString(standard, "unitCode");
    const weight = optionalNumber(item, "weight");
    const threshold = optionalNumber(standard, "threshold");
    const min = optionalNumber(standard, "min");
    const max = optionalNumber(standard, "max");
    const text = optionalString(standard, "text");
    return {
      code: normalizeCode(stringValue(item, "code")),
      label: { en: stringValue(label, "en"), fr: stringValue(label, "fr") },
      whatIsChecked: { en: stringValue(check, "en"), fr: stringValue(check, "fr") },
      resultKind: enumValue(item, "resultKind", resultKinds),
      standard: {
        operator: enumValue(standard, "operator", standardOperators),
        ...(threshold !== undefined ? { threshold } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(unitCode ? { unitCode: unitCode.toUpperCase() } : {}),
        ...(text ? { text } : {}),
      },
      mandatory: boolValue(item, "mandatory"),
      ...(weight !== undefined ? { weight } : {}),
    } satisfies InspectionMetric;
  });
}

function readGrades(body: unknown): readonly InspectionGrade[] {
  const array = arrayValue(body, "grades");
  return array.map((raw, index) => {
    const item = expectObject(raw, `grades[${index}]`);
    const label = expectObject(item.label, `grades[${index}].label`);
    const minScore = optionalNumber(item, "minScore");
    return {
      code: normalizeCode(stringValue(item, "code")),
      label: { en: stringValue(label, "en"), fr: stringValue(label, "fr") },
      rank: integer(item, "rank"),
      ...(minScore !== undefined ? { minScore } : {}),
      ...("requiredPasses" in item ? { requiredPasses: stringArray(item, "requiredPasses").map(normalizeCode) } : {}),
    } satisfies InspectionGrade;
  });
}

function normalizeCode(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new BadRequestException("code must not be empty");
  return trimmed.toUpperCase().replaceAll(/\s+/g, "_");
}

function stringValue(body: unknown, name: string): string {
  if (typeof body !== "object" || body === null || !(name in body)) throw new BadRequestException(`${name} is required`);
  const value = (body as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.trim().length === 0) throw new BadRequestException(`${name} must be a non-empty string`);
  return value.trim();
}

function optionalString(body: unknown, name: string): string | undefined {
  if (typeof body !== "object" || body === null || !(name in body)) return undefined;
  const value = (body as Record<string, unknown>)[name];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new BadRequestException(`${name} must be a string`);
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalNumber(body: unknown, name: string): number | undefined {
  if (typeof body !== "object" || body === null || !(name in body)) return undefined;
  const value = (body as Record<string, unknown>)[name];
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new BadRequestException(`${name} must be a number`);
  return parsed;
}

function integer(body: unknown, name: string): number {
  const value = optionalNumber(body, name);
  if (value === undefined || !Number.isInteger(value)) throw new BadRequestException(`${name} must be an integer`);
  return value;
}

function boolValue(body: unknown, name: string): boolean {
  if (typeof body !== "object" || body === null || !(name in body)) throw new BadRequestException(`${name} is required`);
  const value = (body as Record<string, unknown>)[name];
  if (typeof value !== "boolean") throw new BadRequestException(`${name} must be a boolean`);
  return value;
}

function arrayValue(body: unknown, name: string): readonly unknown[] {
  if (typeof body !== "object" || body === null || !(name in body)) throw new BadRequestException(`${name} is required`);
  const value = (body as Record<string, unknown>)[name];
  if (!Array.isArray(value)) throw new BadRequestException(`${name} must be an array`);
  return value;
}

function stringArray(body: unknown, name: string): readonly string[] {
  const array = arrayValue(body, name);
  return array.map((v, i) => {
    if (typeof v !== "string" || v.trim().length === 0) throw new BadRequestException(`${name}[${i}] must be a non-empty string`);
    return v.trim();
  });
}

function expectObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BadRequestException(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function enumValue<const T extends string>(body: unknown, name: string, values: readonly T[]): T {
  const value = stringValue(body, name) as T;
  if (!values.includes(value)) throw new BadRequestException(`Invalid ${name}`);
  return value;
}

function assertEnum<const T extends string>(value: string, values: readonly T[], name: string): T {
  if (!values.includes(value as T)) throw new BadRequestException(`Invalid ${name}`);
  return value as T;
}
