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
import type { LotQuantity } from "../inventory/inventory.repository.js";
import { WarehousingService } from "./warehousing.service.js";

@Controller("v1/warehouse-receipts")
export class WarehousingController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(WarehousingService) private readonly warehousing: WarehousingService,
  ) {}

  @Post()
  async issue(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const receipt = await this.warehousing.issue(
      await this.actors.fromRequest(request),
      stringValue(body, "warehouseOrganizationId"),
      stringValue(body, "lotId"),
      quantity(body),
    );
    response.setHeader("ETag", receipt.etag);
    return { data: receipt };
  }

  @Get(":id")
  async get(@Req() request: Request, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    const receipt = await this.warehousing.get(await this.actors.fromRequest(request), id);
    response.setHeader("ETag", receipt.etag);
    return { data: receipt };
  }

  @Post(":id/pledge")
  @HttpCode(200)
  async pledge(@Req() request: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const receipt = await this.warehousing.pledge(
      await this.actors.fromRequest(request),
      id,
      stringValue(body, "pledgeeOrganizationId"),
      stringValue(body, "pledgeReference"),
      requireEtag(etag),
    );
    response.setHeader("ETag", receipt.etag);
    return { data: receipt };
  }

  @Post(":id/release-pledge")
  @HttpCode(200)
  async releasePledge(@Req() request: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const receipt = await this.warehousing.releasePledge(
      await this.actors.fromRequest(request),
      id,
      stringValue(body, "reason"),
      requireEtag(etag),
    );
    response.setHeader("ETag", receipt.etag);
    return { data: receipt };
  }

  @Post(":id/transfer")
  @HttpCode(200)
  async transfer(@Req() request: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const receipt = await this.warehousing.transfer(
      await this.actors.fromRequest(request),
      id,
      stringValue(body, "newOwnerOrganizationId"),
      requireEtag(etag),
    );
    response.setHeader("ETag", receipt.etag);
    return { data: receipt };
  }

  @Post(":id/release")
  @HttpCode(200)
  async release(@Req() request: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Res({ passthrough: true }) response: Response) {
    const receipt = await this.warehousing.release(
      await this.actors.fromRequest(request),
      id,
      requireEtag(etag),
    );
    response.setHeader("ETag", receipt.etag);
    return { data: receipt };
  }
}

function quantity(body: unknown): LotQuantity {
  if (typeof body !== "object" || body === null || !("quantity" in body)) {
    throw new BadRequestException("quantity is required");
  }
  const value = (body as Record<string, unknown>).quantity;
  const quantityValue = integerValue(value, "value");
  const scale = integerValue(value, "scale");
  if (quantityValue <= 0 || scale < 0 || scale > 6) {
    throw new BadRequestException("Invalid quantity");
  }
  return { value: quantityValue, scale, unitCode: stringValue(value, "unitCode").toUpperCase() };
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

function integerValue(body: unknown, name: string): number {
  if (typeof body !== "object" || body === null || !(name in body)) {
    throw new BadRequestException(`${name} is required`);
  }
  const value = (body as Record<string, unknown>)[name];
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