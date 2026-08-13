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
import { Public } from "../identity/public-route.js";
import { RequestActorService } from "../identity/request-actor.service.js";
import type { ProviderEvent, ProviderEventType } from "./settlement.repository.js";
import { SettlementService } from "./settlement.service.js";

@Controller("v1/settlements")
export class SettlementController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(SettlementService) private readonly settlement: SettlementService,
  ) {}

  @Post()
  async initialize(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.settlement.initialize(
      await this.actors.fromRequest(request),
      stringValue(body, "rfqId"),
      stringValue(body, "tradeId"),
    );
    response.setHeader("ETag", value.etag);
    return { data: value };
  }

  @Get(":id")
  async get(
    @Req() request: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.settlement.get(await this.actors.fromRequest(request), id);
    response.setHeader("ETag", data.settlement.etag);
    return { data };
  }

  @Post(":id/request-release")
  @HttpCode(200)
  async requestRelease(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.settlement.requestAction(
      await this.actors.fromRequest(request),
      id,
      "release",
      requireEtag(etag),
    );
    response.setHeader("ETag", value.etag);
    return { data: value };
  }

  @Post(":id/request-refund")
  @HttpCode(200)
  async requestRefund(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.settlement.requestAction(
      await this.actors.fromRequest(request),
      id,
      "refund",
      requireEtag(etag),
    );
    response.setHeader("ETag", value.etag);
    return { data: value };
  }

  @Public()
  @Post("provider-events/callback")
  @HttpCode(200)
  async providerCallback(
    @Headers("x-escrow-signature") signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (signature === undefined) {
      throw new BadRequestException("x-escrow-signature is required");
    }
    const event = providerEvent(body);
    return { data: await this.settlement.applyProviderEvent(event, signature) };
  }
}

function providerEvent(body: unknown): ProviderEvent {
  const type = stringValue(body, "type") as ProviderEventType;
  if (!["FUNDED", "RELEASED", "REFUNDED"].includes(type)) {
    throw new BadRequestException("Invalid provider event type");
  }
  const occurredAt = stringValue(body, "occurredAt");
  if (!Number.isFinite(new Date(occurredAt).getTime())) {
    throw new BadRequestException("occurredAt must be an ISO date");
  }
  return {
    eventId: stringValue(body, "eventId"),
    settlementId: stringValue(body, "settlementId"),
    type,
    providerReference: stringValue(body, "providerReference"),
    occurredAt,
  };
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

function requireEtag(etag: string | undefined): string {
  if (etag === undefined || etag.length === 0) {
    throw new BadRequestException("If-Match header is required");
  }
  return etag;
}