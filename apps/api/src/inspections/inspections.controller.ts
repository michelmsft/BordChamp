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
import type {
  FindingResult,
  InspectionFinding,
  InspectionType,
} from "./inspection.repository.js";
import { InspectionsService } from "./inspections.service.js";

const inspectionTypes: readonly InspectionType[] = [
  "quality",
  "sanitary",
  "veterinary",
  "aquacultureHealth",
  "coldChain",
];
const findingResults: readonly FindingResult[] = [
  "pass",
  "fail",
  "notApplicable",
];

@Controller("v1/inspections")
export class InspectionsController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(InspectionsService)
    private readonly inspections: InspectionsService,
  ) {}

  @Post()
  async requestInspection(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const inspection = await this.inspections.request(
      await this.actors.fromRequest(request),
      {
        lotId: stringValue(body, "lotId"),
        type: enumValue(body, "type", inspectionTypes),
        assignedInspectorUserId: stringValue(body, "assignedInspectorUserId"),
      },
    );
    response.setHeader("ETag", inspection.etag);
    return { data: inspection };
  }

  @Get(":id")
  async get(
    @Req() request: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const inspection = await this.inspections.get(
      await this.actors.fromRequest(request),
      id,
    );
    response.setHeader("ETag", inspection.etag);
    return { data: inspection };
  }

  @Post(":id/finalize")
  @HttpCode(200)
  async finalize(
    @Req() request: Request,
    @Param("id") id: string,
    @Headers("if-match") etag: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = enumValue(body, "outcome", ["pass", "fail"] as const);
    const inspection = await this.inspections.finalize(
      await this.actors.fromRequest(request),
      id,
      {
        outcome,
        certificateNumber: stringValue(body, "certificateNumber"),
        findings: findings(body),
        ...optionalString(body, "gradeCode"),
        ...optionalString(body, "certificateValidUntil"),
      },
      requireEtag(etag),
    );
    response.setHeader("ETag", inspection.etag);
    return { data: inspection };
  }
}

function findings(body: unknown): readonly InspectionFinding[] {
  if (typeof body !== "object" || body === null || !("findings" in body)) {
    throw new BadRequestException("findings is required");
  }
  const value = (body as Record<string, unknown>).findings;
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("findings must be a non-empty array");
  }
  return value.map((item, index) => {
    const code = stringValue(item, "code");
    const result = enumValue(item, "result", findingResults);
    const notes = optionalString(item, "notes");
    if (result === "fail" && notes.notes === undefined) {
      throw new BadRequestException(`findings[${index}].notes is required for failures`);
    }
    return { code, result, ...notes };
  });
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

function optionalString<const T extends "gradeCode" | "certificateValidUntil" | "notes">(
  body: unknown,
  name: T,
): Partial<Record<T, string>> {
  if (typeof body !== "object" || body === null || !(name in body)) {
    return {};
  }
  return { [name]: stringValue(body, name) } as Partial<Record<T, string>>;
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