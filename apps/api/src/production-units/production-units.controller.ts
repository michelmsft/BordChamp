import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { RequestActorService } from "../identity/request-actor.service.js";
import type { LotCategory } from "../inventory/inventory.repository.js";
import type { ProductionUnitType } from "./production-unit.repository.js";
import { ProductionUnitsService } from "./production-units.service.js";

const unitTypes: readonly ProductionUnitType[] = [
  "field",
  "greenhouse",
  "pond",
  "tank",
  "cage",
  "barn",
  "coop",
  "pen",
  "snailery",
  "processingFacility",
];
const categories: readonly LotCategory[] = [
  "crop",
  "aquaculture",
  "liveAnimal",
  "animalProduct",
];

@Controller("v1/production-units")
export class ProductionUnitsController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(ProductionUnitsService)
    private readonly units: ProductionUnitsService,
  ) {}

  @Post()
  async create(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const type = enumValue(body, "type", unitTypes);
    const supportedCategory = enumValue(
      body,
      "supportedCategory",
      categories,
    );
    const unit = await this.units.create(await this.actors.fromRequest(request), {
      ownerOrganizationId: stringValue(body, "ownerOrganizationId"),
      type,
      name: stringValue(body, "name"),
      supportedCategory,
    });
    response.setHeader("ETag", unit.etag);
    return { data: unit };
  }

  @Get(":id")
  async get(
    @Req() request: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const unit = await this.units.get(await this.actors.fromRequest(request), id);
    response.setHeader("ETag", unit.etag);
    return { data: unit };
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  async deactivate(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const unit = await this.units.deactivate(
      await this.actors.fromRequest(request),
      id,
      stringValue(body, "reason"),
      requireEtag(etag),
    );
    response.setHeader("ETag", unit.etag);
    return { data: unit };
  }
}

function stringValue(body: unknown, name: string): string {
  if (typeof body !== "object" || body === null || !(name in body)) {
    throw new BadRequestException(`${name} is required`);
  }
  const value = (body as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function enumValue<const T extends string>(
  body: unknown,
  name: string,
  values: readonly T[],
): T {
  const value = stringValue(body, name) as T;
  if (!values.includes(value)) {
    throw new BadRequestException(`Invalid ${name}`);
  }
  return value;
}

function requireEtag(etag: string | undefined): string {
  if (etag === undefined || etag.length === 0) {
    throw new BadRequestException("If-Match header is required");
  }
  return etag;
}