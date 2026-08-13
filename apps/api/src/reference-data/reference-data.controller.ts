import { Controller, Get, Inject } from "@nestjs/common";
import { Public } from "../identity/public-route.js";

import {
  type InspectionScheme,
  type PublicCommodity,
  ReferenceDataService,
  type Unit,
} from "./reference-data.service.js";

@Controller("v1/public/reference-data")
export class ReferenceDataController {
  constructor(
    @Inject(ReferenceDataService)
    private readonly referenceData: ReferenceDataService,
  ) {}

  @Public()
  @Get("commodities")
  async listCommodities(): Promise<{ readonly data: readonly PublicCommodity[] }> {
    return { data: await this.referenceData.listPublicCommodities() };
  }

  @Public()
  @Get("units")
  async listUnits(): Promise<{ readonly data: readonly Unit[] }> {
    return { data: await this.referenceData.listActiveUnits() };
  }

  @Public()
  @Get("inspection-schemes")
  async listInspectionSchemes(): Promise<{ readonly data: readonly InspectionScheme[] }> {
    return { data: await this.referenceData.listActiveSchemes() };
  }
}