import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { RequestActorService } from "../identity/request-actor.service.js";
import type {
  LotCategory,
  LotQuantity,
} from "./inventory.repository.js";
import { InventoryService } from "./inventory.service.js";

const categories: readonly LotCategory[] = [
  "crop",
  "aquaculture",
  "liveAnimal",
  "animalProduct",
];

@Controller("v1/inventory/lots")
export class InventoryController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Post()
  async create(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseCreateLot(body);
    const lot = await this.inventory.create(
      await this.actors.fromRequest(request),
      input,
    );
    response.setHeader("ETag", lot.etag);
    return { data: lot };
  }

  @Get(":id")
  async get(
    @Req() request: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const lot = await this.inventory.get(await this.actors.fromRequest(request), id);
    response.setHeader("ETag", lot.etag);
    return { data: lot };
  }

  @Patch(":id/quantity")
  async updateQuantity(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const lot = await this.inventory.updateQuantity(
      await this.actors.fromRequest(request),
      id,
      parseQuantity(body),
      requireEtag(etag),
    );
    response.setHeader("ETag", lot.etag);
    return { data: lot };
  }

  @Post(":id/mark-available")
  @HttpCode(200)
  async markAvailable(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const lot = await this.inventory.markAvailable(
      await this.actors.fromRequest(request),
      id,
      requireEtag(etag),
    );
    response.setHeader("ETag", lot.etag);
    return { data: lot };
  }

  @Post(":id/quarantine")
  @HttpCode(200)
  async quarantine(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const lot = await this.inventory.quarantine(
      await this.actors.fromRequest(request),
      id,
      requiredString(body, "reason"),
      requireEtag(etag),
    );
    response.setHeader("ETag", lot.etag);
    return { data: lot };
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
    const lot = await this.inventory.deactivate(
      await this.actors.fromRequest(request),
      id,
      requiredString(body, "reason"),
      requireEtag(etag),
    );
    response.setHeader("ETag", lot.etag);
    return { data: lot };
  }
}

function parseCreateLot(body: unknown) {
  const category = requiredString(body, "category");
  if (!categories.includes(category as LotCategory)) {
    throw new BadRequestException("Invalid lot category");
  }
  return {
    ownerOrganizationId: requiredString(body, "ownerOrganizationId"),
    category: category as LotCategory,
    commodityCode: requiredString(body, "commodityCode").toUpperCase(),
    quantity: parseQuantity(property(body, "quantity")),
    ...optionalProperty(body, "productionUnitId"),
    ...optionalProperty(body, "productionDate"),
    ...optionalProperty(body, "originRegionCode"),
  };
}

function parseQuantity(body: unknown): LotQuantity {
  const value = requiredInteger(body, "value");
  const scale = requiredInteger(body, "scale");
  if (value <= 0) {
    throw new BadRequestException("quantity.value must be positive");
  }
  if (scale < 0 || scale > 6) {
    throw new BadRequestException("quantity.scale must be between 0 and 6");
  }
  return {
    value,
    scale,
    unitCode: requiredString(body, "unitCode").toUpperCase(),
  };
}

function property(body: unknown, name: string): unknown {
  if (typeof body !== "object" || body === null || !(name in body)) {
    throw new BadRequestException(`${name} is required`);
  }
  return (body as Record<string, unknown>)[name];
}

function optionalProperty(
  body: unknown,
  name: "productionUnitId" | "productionDate" | "originRegionCode",
): Partial<Record<typeof name, string>> {
  if (typeof body !== "object" || body === null || !(name in body)) {
    return {};
  }
  return { [name]: requiredString(body, name) };
}

function requiredString(body: unknown, name: string): string {
  const value = property(body, name);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requiredInteger(body: unknown, name: string): number {
  const value = property(body, name);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new BadRequestException(`${name} must be a safe integer`);
  }
  return value;
}

function requireEtag(etag: string | undefined): string {
  if (etag === undefined || etag.length === 0) {
    throw new BadRequestException("If-Match header is required");
  }
  return etag;
}