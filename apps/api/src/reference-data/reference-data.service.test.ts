import type { ActorContext } from "@bordchamp/domain";
import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { CommodityRepository } from "./commodity.repository.js";
import type { InspectionSchemeRepository, UpsertInspectionSchemeInput } from "./inspection-scheme.repository.js";
import { ReferenceDataService } from "./reference-data.service.js";
import type { UnitRepository } from "./unit.repository.js";

const admin: ActorContext = {
  userId: "admin-1",
  personas: ["ExchangeAdmin"],
  representedOrganizationIds: [],
  assignmentIds: [],
};

function serviceWith(options: {
  units?: readonly { code: string; baseUnitCode?: string }[];
  commodities?: readonly { code: string; defaultUnitCode?: string; allowedUnitCodes: readonly string[] }[];
  schemes?: readonly { commodityCode: string; type: "quality"; metrics: readonly { standard: { unitCode?: string } }[] }[];
}) {
  const deleteUnit = vi.fn<(code: string) => Promise<void>>().mockResolvedValue(undefined);
  const units = {
    listAll: vi.fn().mockResolvedValue(options.units ?? [{ code: "BOX" }]),
    delete: deleteUnit,
  } as unknown as UnitRepository;
  const commodities = {
    listAll: vi.fn().mockResolvedValue(options.commodities ?? []),
  } as unknown as CommodityRepository;
  const schemes = {
    listAll: vi.fn().mockResolvedValue(options.schemes ?? []),
  } as unknown as InspectionSchemeRepository;
  return { service: new ReferenceDataService(commodities, units, schemes), deleteUnit };
}

describe("ReferenceDataService.deleteUnit", () => {
  it("deletes an unreferenced unit", async () => {
    const { service, deleteUnit } = serviceWith({});

    await service.deleteUnit(admin, "box");

    expect(deleteUnit).toHaveBeenCalledWith("BOX");
  });

  it("ignores a legacy self-base reference on the unit being deleted", async () => {
    const { service, deleteUnit } = serviceWith({ units: [{ code: "TRL", baseUnitCode: "TRL" }] });

    await service.deleteUnit(admin, "TRL");

    expect(deleteUnit).toHaveBeenCalledWith("TRL");
  });

  it("rejects a unit referenced by a product", async () => {
    const { service, deleteUnit } = serviceWith({
      commodities: [{ code: "TOMATO", defaultUnitCode: "BOX", allowedUnitCodes: ["BOX"] }],
    });

    await expect(service.deleteUnit(admin, "BOX")).rejects.toBeInstanceOf(ConflictException);
    expect(deleteUnit).not.toHaveBeenCalled();
  });
});

const schemeInput: UpsertInspectionSchemeInput = {
  commodityCode: "TILAPIA",
  type: "quality",
  labelEn: "Tilapia quality copy",
  labelFr: "Copie qualité tilapia",
  metrics: [],
  grades: [],
  status: "active",
};

function schemeService(existing: unknown) {
  const upsert = vi.fn().mockResolvedValue({
    commodityCode: schemeInput.commodityCode,
    type: schemeInput.type,
    label: { en: schemeInput.labelEn, fr: schemeInput.labelFr },
    metrics: [],
    grades: [],
    status: "active",
    updatedAt: "2026-08-13T00:00:00.000Z",
  });
  const schemes = { get: vi.fn().mockResolvedValue(existing), upsert } as unknown as InspectionSchemeRepository;
  const service = new ReferenceDataService({} as CommodityRepository, {} as UnitRepository, schemes);
  return { service, upsert };
}

describe("ReferenceDataService.createScheme", () => {
  it("creates a control when the product/type key is available", async () => {
    const { service, upsert } = schemeService(undefined);

    await service.createScheme(admin, schemeInput);

    expect(upsert).toHaveBeenCalledWith(schemeInput);
  });

  it("rejects an existing product/type key without overwriting it", async () => {
    const { service, upsert } = schemeService({ commodityCode: "TILAPIA", type: "quality" });

    await expect(service.createScheme(admin, schemeInput)).rejects.toBeInstanceOf(ConflictException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
