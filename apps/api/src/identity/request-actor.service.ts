import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ActorContext, Persona } from "@bordchamp/domain";
import { PERSONAS } from "@bordchamp/domain";
import type { Request } from "express";

import type { IdentityRepository } from "./identity.repository.js";
import { IDENTITY_REPOSITORY } from "./identity.repository.js";
import type { OrganizationRepository } from "../organizations/organization.repository.js";
import { ORGANIZATION_REPOSITORY } from "../organizations/organization.repository.js";

export interface ActorPrincipal {
  readonly userId: string;
  readonly sessionVersion: number;
}

const principalStore = new WeakMap<Request, ActorPrincipal>();
const actorCache = new WeakMap<Request, ActorContext>();
const representedCache = new Map<string, readonly string[]>();

export function invalidateRepresentedCache(userId?: string): void {
  if (userId === undefined) representedCache.clear();
  else representedCache.delete(userId);
}

@Injectable()
export class RequestActorService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  authenticate(request: Request, principal: ActorPrincipal): void {
    principalStore.set(request, principal);
  }

  async authenticateTestRequest(request: Request): Promise<boolean> {
    if (process.env.NODE_ENV !== "test") return false;
    const userId = readHeader(request, "x-user-id");
    if (userId === undefined) return false;
    const email = readHeader(request, "x-user-email") ?? `${userId}@test.bordchamp.local`;
    const profile = await this.identities.ensureTestProfile(userId, email);
    this.authenticate(request, { userId: profile.id, sessionVersion: profile.sessionVersion });
    return true;
  }

  principal(request: Request): ActorPrincipal {
    const value = principalStore.get(request);
    if (!value) throw new UnauthorizedException("Request is not authenticated");
    return value;
  }

  async fromRequest(request: Request): Promise<ActorContext> {
    const cached = actorCache.get(request);
    if (cached) return cached;
    const principal = this.principal(request);
    const personas = readPersonas(request);
    const organizationId = readHeader(request, "x-organization-id");
    const representedFromHeader = readListHeader(request, "x-represented-organizations");
    let represented: readonly string[];
    if (representedFromHeader.length > 0) {
      represented = representedFromHeader;
    } else if (process.env.NODE_ENV === "test") {
      const cached = representedCache.get(principal.userId);
      if (cached !== undefined) {
        represented = cached;
      } else {
        represented = await this.organizations.resolveRepresentedOrganizations(principal.userId);
        representedCache.set(principal.userId, represented);
      }
    } else {
      represented = await this.organizations.resolveRepresentedOrganizations(principal.userId);
    }
    const assignments = readListHeader(request, "x-assignments");
    const actor: ActorContext = {
      userId: principal.userId,
      ...(organizationId === undefined ? {} : { organizationId }),
      personas,
      representedOrganizationIds: represented,
      assignmentIds: assignments,
    };
    actorCache.set(request, actor);
    return actor;
  }
}

function readHeader(request: Request, name: string): string | undefined {
  const raw = request.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function readListHeader(request: Request, name: string): readonly string[] {
  const raw = readHeader(request, name);
  if (raw === undefined) return [];
  return raw.split(",").map(value => value.trim()).filter(value => value.length > 0);
}

function readPersonas(request: Request): readonly Persona[] {
  const raw = readHeader(request, "x-personas");
  if (raw === undefined) return [];
  const parsed = raw.split(",").map(value => value.trim()).filter(value => PERSONAS.includes(value as Persona)) as Persona[];
  return parsed;
}
