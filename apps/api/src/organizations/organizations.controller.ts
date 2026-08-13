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
import type { OrganizationType } from "./organization.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const organizationTypes: readonly OrganizationType[] = [
  "farmer",
  "cooperative",
  "trader",
  "broker",
  "buyer",
  "warehouse",
  "inspector",
  "logisticsProvider",
];

@Controller("v1/organizations")
export class OrganizationsController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
  ) {}

  @Post()
  async create(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parseCreateOrganization(body);
    const organization = await this.organizations.create(await this.actors.fromRequest(request), input);
    response.setHeader("ETag", organization.etag);
    return { data: organization };
  }

  @Get(":id")
  async get(@Req() request: Request, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    const organization = await this.organizations.get(await this.actors.fromRequest(request), id);
    response.setHeader("ETag", organization.etag);
    return { data: organization };
  }

  @Patch(":id")
  async update(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const name = requiredString(body, "name");
    const organization = await this.organizations.updateName(
      await this.actors.fromRequest(request),
      id,
      name,
      requireEtag(etag),
    );
    response.setHeader("ETag", organization.etag);
    return { data: organization };
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
    const organization = await this.organizations.deactivate(
      await this.actors.fromRequest(request),
      id,
      requiredString(body, "reason"),
      requireEtag(etag),
    );
    response.setHeader("ETag", organization.etag);
    return { data: organization };
  }

  @Post(":id/mandates")
  async createMandate(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    return {
      data: await this.organizations.createMandate(
        await this.actors.fromRequest(request),
        id,
        requiredString(body, "granteeUserId"),
        optionalString(body, "validUntil"),
      ),
    };
  }
}

function parseCreateOrganization(body: unknown): { readonly name: string; readonly type: OrganizationType } {
  const type = requiredString(body, "type");
  if (!organizationTypes.includes(type as OrganizationType)) {
    throw new BadRequestException("Invalid organization type");
  }
  return { name: requiredString(body, "name"), type: type as OrganizationType };
}

function requiredString(body: unknown, property: string): string {
  if (typeof body !== "object" || body === null || !(property in body)) {
    throw new BadRequestException(`${property} is required`);
  }
  const value = (body as Record<string, unknown>)[property];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${property} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(body: unknown, property: string): string | undefined {
  if (typeof body !== "object" || body === null || !(property in body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[property];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${property} must be a non-empty string`);
  }
  return value.trim();
}

function requireEtag(etag: string | undefined): string {
  if (etag === undefined || etag.length === 0) {
    throw new BadRequestException("If-Match header is required");
  }
  return etag;
}