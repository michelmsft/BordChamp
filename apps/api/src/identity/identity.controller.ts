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
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Persona } from "@bordchamp/domain";
import { PERSONAS } from "@bordchamp/domain";

import { AuthService } from "./auth.service.js";
import type { AuthenticationResult, RefreshCookie } from "./auth.service.js";
import { IdentityService } from "./identity.service.js";
import { Public } from "./public-route.js";
import { RequestActorService } from "./request-actor.service.js";
import type { MembershipRole } from "./identity.repository.js";
import type { OrganizationType } from "../organizations/organization.repository.js";

const ORG_TYPES: readonly OrganizationType[] = [
  "farmer",
  "cooperative",
  "trader",
  "broker",
  "buyer",
  "warehouse",
  "inspector",
  "logisticsProvider",
];

const MEMBERSHIP_ROLES: readonly MembershipRole[] = ["owner", "admin", "member"];
const REFRESH_COOKIE_PATH = "/api/v1/auth";

@Controller("v1")
export class IdentityController {
  constructor(
    @Inject(RequestActorService) private readonly actors: RequestActorService,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  // ---- Auth (public) ----

  @Public()
  @Post("auth/register")
  async register(@Body() body: unknown) {
    const email = requiredString(body, "email");
    const password = requiredString(body, "password");
    const result = await this.auth.register(email, password);
    return { data: result };
  }

  @Public()
  @Post("auth/register/verify")
  async verifyRegister(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const enrollmentToken = requiredString(body, "enrollmentToken");
    const code = requiredString(body, "code");
    const result = await this.auth.verifyRegistration(enrollmentToken, code);
    writeCookie(response, result.refreshCookie);
    return { data: { accessToken: result.accessToken, recoveryCodes: result.recoveryCodes, profile: result.profile } };
  }

  @Public()
  @Post("auth/login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const email = requiredString(body, "email");
    const password = requiredString(body, "password");
    const result = await this.auth.login(email, password);
    if (result.mfaRequired) return { data: result };
    writeCookie(response, result.refreshCookie);
    return { data: { mfaRequired: false, ...response200(result) } };
  }

  @Public()
  @Post("auth/login/verify")
  async verifyLogin(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const challengeToken = requiredString(body, "challengeToken");
    const code = requiredString(body, "code");
    const useRecovery = readBool(body, "useRecovery");
    const result = await this.auth.verifyLogin(challengeToken, code, useRecovery ? "recovery" : "totp");
    writeCookie(response, result.refreshCookie);
    return { data: response200(result) };
  }

  @Public()
  @Post("auth/refresh")
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.refresh(request.headers.cookie);
    writeCookie(response, result.refreshCookie);
    return { data: response200(result) };
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { clearCookie } = await this.auth.logout(request.headers.cookie);
    response.clearCookie(clearCookie, { path: REFRESH_COOKIE_PATH });
    return;
  }

  // ---- Session / profile ----

  @Get("me")
  async me(@Req() request: Request, @Query("organizationId") organizationId?: string) {
    const principal = this.actors.principal(request);
    return { data: await this.identity.session(principal.userId, organizationId) };
  }

  @Get("admin/iam/users")
  async listIamUsers(@Req() request: Request) {
    const principal = this.actors.principal(request);
    return { data: await this.identity.listIamUsers(principal.userId) };
  }

  @Patch("admin/iam/users/:userId")
  async updateIamUser(@Req() request: Request, @Param("userId") userId: string, @Body() body: unknown) {
    const principal = this.actors.principal(request);
    if (typeof body !== "object" || body === null) throw new BadRequestException("Body must be an object");
    const record = body as Record<string, unknown>;
    const changes: { status?: "active" | "suspended" | "inactive"; mfaRequired?: boolean } = {};
    if (record.status !== undefined) {
      if (!['active', 'suspended', 'inactive'].includes(String(record.status))) throw new BadRequestException("status is invalid");
      changes.status = record.status as "active" | "suspended" | "inactive";
    }
    if (record.mfaRequired !== undefined) {
      if (typeof record.mfaRequired !== "boolean") throw new BadRequestException("mfaRequired must be boolean");
      changes.mfaRequired = record.mfaRequired;
    }
    if (Object.keys(changes).length === 0) throw new BadRequestException("No IAM changes provided");
    return { data: await this.identity.updateIamUser(principal.userId, userId, changes) };
  }

  @Post("admin/iam/users/:userId/reset-password")
  @HttpCode(204)
  async resetIamPassword(@Req() request: Request, @Param("userId") userId: string, @Body() body: unknown) {
    const principal = this.actors.principal(request);
    await this.identity.resetIamPassword(principal.userId, userId, requiredString(body, "password"));
  }

  @Patch("admin/iam/users/:userId/memberships/:organizationId")
  async updateIamMembership(
    @Req() request: Request,
    @Param("userId") userId: string,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
  ) {
    const principal = this.actors.principal(request);
    const changes = parseMemberChanges(body);
    if (Object.keys(changes).length === 0) throw new BadRequestException("No membership changes provided");
    return { data: await this.identity.updateIamMembership(principal.userId, userId, organizationId, changes) };
  }

  @Patch("me")
  async updateMe(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers("if-match") etag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = this.actors.principal(request);
    const profile = await this.identity.updateProfile(principal.userId, parseProfileChanges(body), requireEtag(etag));
    response.setHeader("ETag", profile.etag);
    return { data: profile };
  }

  @Post("me/onboarding/complete")
  async completeOnboarding(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers("if-match") etag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = this.actors.principal(request);
    const profile = await this.identity.completeProfileOnboarding(principal.userId, parseProfileChanges(body), requireEtag(etag));
    response.setHeader("ETag", profile.etag);
    return { data: profile };
  }

  @Post("me/active-organization")
  @HttpCode(200)
  async selectOrganization(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers("if-match") etag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = this.actors.principal(request);
    const profile = await this.identity.setActiveOrganization(principal.userId, requiredString(body, "organizationId"), requireEtag(etag));
    response.setHeader("ETag", profile.etag);
    return { data: profile };
  }

  @Post("onboarding/organization")
  async onboardOrganization(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const principal = this.actors.principal(request);
    const actor = await this.actors.fromRequest(request);
    const type = requiredString(body, "type");
    if (!ORG_TYPES.includes(type as OrganizationType)) throw new BadRequestException("Invalid organization type");
    const result = await this.identity.onboardOrganization(principal.userId, actor.personas, {
      name: requiredString(body, "name"),
      type: type as OrganizationType,
    });
    response.setHeader("ETag", result.profile.etag);
    return { data: result };
  }

  // ---- Memberships ----

  @Get("organizations/:organizationId/members")
  async listMembers(@Req() request: Request, @Param("organizationId") organizationId: string) {
    const principal = this.actors.principal(request);
    return { data: await this.identity.listMembers(principal.userId, organizationId) };
  }

  @Patch("organizations/:organizationId/members/:userId")
  async updateMember(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("userId") targetUserId: string,
    @Body() body: unknown,
    @Headers("if-match") etag: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = this.actors.principal(request);
    const changes = parseMemberChanges(body);
    const membership = await this.identity.updateMember(principal.userId, organizationId, targetUserId, changes, requireEtag(etag));
    response.setHeader("ETag", membership.etag);
    return { data: membership };
  }

  // ---- Invitations ----

  @Post("organizations/:organizationId/invitations")
  async createInvitation(@Req() request: Request, @Param("organizationId") organizationId: string, @Body() body: unknown) {
    const principal = this.actors.principal(request);
    const email = requiredString(body, "email");
    const role = requiredString(body, "role");
    if (!MEMBERSHIP_ROLES.includes(role as MembershipRole)) throw new BadRequestException("Invalid role");
    const personas = parsePersonaList(body, "personas");
    const expiresAt = requiredString(body, "expiresAt");
    const result = await this.identity.createInvitation(principal.userId, organizationId, {
      email,
      role: role as MembershipRole,
      personas,
      expiresAt,
    });
    return { data: result };
  }

  @Get("organizations/:organizationId/invitations")
  async listInvitations(@Req() request: Request, @Param("organizationId") organizationId: string) {
    const principal = this.actors.principal(request);
    return { data: await this.identity.listInvitations(principal.userId, organizationId) };
  }

  @Post("invitations/:organizationId/:invitationId/accept")
  @HttpCode(200)
  async acceptInvitation(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Body() body: unknown,
  ) {
    const principal = this.actors.principal(request);
    const secret = requiredString(body, "secret");
    return { data: await this.identity.acceptInvitation(principal.userId, organizationId, invitationId, secret) };
  }

  @Post("organizations/:organizationId/invitations/:invitationId/revoke")
  @HttpCode(200)
  async revokeInvitation(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Headers("if-match") etag: string | undefined,
  ) {
    const principal = this.actors.principal(request);
    return { data: await this.identity.revokeInvitation(principal.userId, organizationId, invitationId, requireEtag(etag)) };
  }
}

function response200(result: AuthenticationResult) {
  return { accessToken: result.accessToken, profile: result.profile };
}

function writeCookie(response: Response, cookie: RefreshCookie) {
  response.cookie(cookie.name, cookie.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: cookie.maxAgeSeconds * 1000,
  });
}

function parseProfileChanges(body: unknown) {
  if (typeof body !== "object" || body === null) throw new BadRequestException("Body must be an object");
  const record = body as Record<string, unknown>;
  const changes: {
    displayName?: string;
    givenName?: string;
    surname?: string;
    locale?: string;
  } = {};
  if (record.displayName !== undefined) changes.displayName = requiredString(record, "displayName");
  if (record.givenName !== undefined) changes.givenName = requiredString(record, "givenName");
  if (record.surname !== undefined) changes.surname = requiredString(record, "surname");
  if (record.locale !== undefined) changes.locale = requiredString(record, "locale");
  return changes;
}

function parseMemberChanges(body: unknown) {
  if (typeof body !== "object" || body === null) throw new BadRequestException("Body must be an object");
  const record = body as Record<string, unknown>;
  const changes: { role?: MembershipRole; personas?: readonly Persona[]; status?: "active" | "suspended" | "revoked" } = {};
  if (record.role !== undefined) {
    const role = requiredString(record, "role");
    if (!MEMBERSHIP_ROLES.includes(role as MembershipRole)) throw new BadRequestException("Invalid role");
    changes.role = role as MembershipRole;
  }
  if (record.personas !== undefined) changes.personas = parsePersonaList(record, "personas");
  if (record.status !== undefined) {
    const status = requiredString(record, "status");
    if (!["active", "suspended", "revoked"].includes(status)) throw new BadRequestException("Invalid status");
    changes.status = status as "active" | "suspended" | "revoked";
  }
  return changes;
}

function parsePersonaList(body: unknown, name: string): readonly Persona[] {
  const raw = (body as Record<string, unknown>)[name];
  if (!Array.isArray(raw)) throw new BadRequestException(`${name} must be an array`);
  const parsed = raw.filter((value): value is Persona => typeof value === "string" && PERSONAS.includes(value as Persona));
  return parsed;
}

function requiredString(body: unknown, property: string): string {
  if (typeof body !== "object" || body === null || !(property in body)) throw new BadRequestException(`${property} is required`);
  const value = (body as Record<string, unknown>)[property];
  if (typeof value !== "string" || value.trim().length === 0) throw new BadRequestException(`${property} must be a non-empty string`);
  return value;
}

function readBool(body: unknown, property: string): boolean {
  if (typeof body !== "object" || body === null) return false;
  const value = (body as Record<string, unknown>)[property];
  return value === true;
}

function requireEtag(etag: string | undefined): string {
  if (typeof etag !== "string" || etag.trim().length === 0) throw new BadRequestException("If-Match header is required");
  return etag;
}
