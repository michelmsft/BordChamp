import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Persona } from "@bordchamp/domain";
import { PERSONAS } from "@bordchamp/domain";

import {
  IDENTITY_REPOSITORY,
  IdentityConflictError,
  IdentityNotFoundError,
  type IdentityRepository,
  type Invitation,
  type Membership,
  type MembershipRole,
  type ProfileChanges,
  type UserProfile,
} from "./identity.repository.js";
import type { OrganizationRepository } from "../organizations/organization.repository.js";
import { ORGANIZATION_REPOSITORY, type OrganizationType } from "../organizations/organization.repository.js";

export interface SessionView {
  readonly profile: UserProfile;
  readonly memberships: readonly Membership[];
  readonly activeOrganizationId?: string;
  readonly activeMembership?: Membership;
  readonly effectivePersonas: readonly Persona[];
  readonly organizations: Readonly<Record<string, { readonly id: string; readonly name: string; readonly type: OrganizationType }>>;
}

const PERSONA_BY_TYPE: Record<OrganizationType, Persona> = {
  farmer: "Farmer",
  cooperative: "CooperativeManager",
  trader: "Trader",
  broker: "Broker",
  buyer: "Buyer",
  warehouse: "WarehouseOperator",
  inspector: "Inspector",
  logisticsProvider: "LogisticsProvider",
};

@Injectable()
export class IdentityService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async session(userId: string, selectedOrganizationId?: string): Promise<SessionView> {
    const profile = await this.identities.getProfile(userId);
    if (!profile) throw new NotFoundException("Profile not found");
    const memberships = await this.identities.listMemberships(userId);
    const active = pickActiveMembership(memberships, selectedOrganizationId ?? profile.preferredOrganizationId);
    const uniqueOrgIds = Array.from(new Set(memberships.map(m => m.organizationId)));
    const resolved = await Promise.all(uniqueOrgIds.map(async id => [id, await this.organizations.get(id)] as const));
    const organizations: Record<string, { id: string; name: string; type: OrganizationType }> = {};
    for (const [id, org] of resolved) {
      if (org) organizations[id] = { id: org.id, name: org.name, type: org.type };
    }
    return {
      profile,
      memberships,
      ...(active === undefined ? {} : { activeOrganizationId: active.organizationId, activeMembership: active }),
      effectivePersonas: active?.personas ?? [],
      organizations,
    };
  }

  async updateProfile(userId: string, changes: ProfileChanges, etag: string): Promise<UserProfile> {
    if (changes.displayName !== undefined) requireNonEmpty(changes.displayName, "displayName");
    if (changes.givenName !== undefined) requireNonEmpty(changes.givenName, "givenName");
    if (changes.surname !== undefined) requireNonEmpty(changes.surname, "surname");
    if (changes.locale !== undefined) requireNonEmpty(changes.locale, "locale");
    return this.map(() => this.identities.updateProfile(userId, changes, etag));
  }

  async completeProfileOnboarding(userId: string, changes: ProfileChanges, etag: string): Promise<UserProfile> {
    requireNonEmpty(changes.displayName, "displayName");
    requireNonEmpty(changes.givenName, "givenName");
    requireNonEmpty(changes.surname, "surname");
    requireNonEmpty(changes.locale, "locale");
    const next = await this.map(() => this.identities.updateProfile(userId, {
      ...changes,
      onboardingState: "organizationRequired",
    }, etag));
    return next;
  }

  async setActiveOrganization(userId: string, organizationId: string, etag: string): Promise<UserProfile> {
    const memberships = await this.identities.listMemberships(userId);
    if (!memberships.some(value => value.organizationId === organizationId && value.status === "active")) {
      throw new ForbiddenException("Actor is not an active member of the organization");
    }
    return this.map(() => this.identities.setPreferredOrganization(userId, organizationId, etag));
  }

  async onboardOrganization(userId: string, personas: readonly Persona[], input: { name: string; type: OrganizationType }): Promise<{ readonly profile: UserProfile; readonly membership: Membership }> {
    const profile = await this.identities.getProfile(userId);
    if (!profile) throw new NotFoundException("Profile not found");
    if (profile.onboardingState !== "organizationRequired" && profile.onboardingState !== "complete") {
      throw new BadRequestException("Complete profile before creating an organization");
    }
    const derivedPersonas = personas.length > 0 ? uniquePersonas(personas) : [PERSONA_BY_TYPE[input.type]];
    const organization = await this.organizations.create({
      name: input.name,
      type: input.type,
      ownerUserId: userId,
    });
    const membership = await this.identities.addMembership({
      userId,
      organizationId: organization.id,
      role: "owner",
      personas: derivedPersonas,
      status: "active",
      joinedAt: new Date().toISOString(),
    });
    const updated = await this.map(() => this.identities.setPreferredOrganization(userId, organization.id, profile.etag));
    return { profile: updated, membership };
  }

  async listMembers(actorUserId: string, organizationId: string): Promise<readonly Membership[]> {
    await this.requireOwnerOrAdmin(actorUserId, organizationId);
    return this.identities.listOrganizationMembers(organizationId);
  }

  async updateMember(actorUserId: string, organizationId: string, targetUserId: string, changes: { role?: MembershipRole; personas?: readonly Persona[]; status?: Membership["status"] }, etag: string): Promise<Membership> {
    await this.requireOwnerOrAdmin(actorUserId, organizationId);
    if (changes.personas !== undefined) changes = { ...changes, personas: uniquePersonas(changes.personas) };
    return this.map(() => this.identities.updateMembership(organizationId, targetUserId, changes, etag));
  }

  async createInvitation(actorUserId: string, organizationId: string, input: { email: string; role: MembershipRole; personas: readonly Persona[]; expiresAt: string }): Promise<{ invitation: Invitation; secret: string }> {
    await this.requireOwnerOrAdmin(actorUserId, organizationId);
    requireNonEmpty(input.email, "email");
    if (!/^\d{4}-\d{2}-\d{2}T/u.test(input.expiresAt)) throw new BadRequestException("expiresAt must be ISO-8601");
    return this.identities.createInvitation({
      organizationId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      personas: uniquePersonas(input.personas),
      expiresAt: input.expiresAt,
      invitedByUserId: actorUserId,
    });
  }

  async listInvitations(actorUserId: string, organizationId: string): Promise<readonly Invitation[]> {
    await this.requireOwnerOrAdmin(actorUserId, organizationId);
    return this.identities.listInvitations(organizationId);
  }

  async acceptInvitation(userId: string, organizationId: string, invitationId: string, secret: string): Promise<Membership> {
    return this.map(() => this.identities.acceptInvitation(organizationId, invitationId, secret, userId));
  }

  async revokeInvitation(actorUserId: string, organizationId: string, invitationId: string, etag: string): Promise<Invitation> {
    await this.requireOwnerOrAdmin(actorUserId, organizationId);
    return this.map(() => this.identities.revokeInvitation(organizationId, invitationId, etag));
  }

  private async requireOwnerOrAdmin(userId: string, organizationId: string): Promise<Membership> {
    const memberships = await this.identities.listMemberships(userId);
    const membership = memberships.find(value => value.organizationId === organizationId);
    if (!membership || membership.status !== "active" || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new ForbiddenException("Owner or admin membership required");
    }
    return membership;
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof IdentityConflictError) throw new ConflictException("Record changed; refresh and retry");
      if (error instanceof IdentityNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}

function pickActiveMembership(memberships: readonly Membership[], preferred: string | undefined): Membership | undefined {
  if (memberships.length === 0) return undefined;
  const active = memberships.filter(value => value.status === "active");
  if (active.length === 0) return undefined;
  if (preferred !== undefined) {
    const match = active.find(value => value.organizationId === preferred);
    if (match) return match;
  }
  return active[0];
}

function uniquePersonas(values: readonly Persona[]): readonly Persona[] {
  const set = new Set<Persona>();
  for (const value of values) {
    if (PERSONAS.includes(value)) set.add(value);
  }
  return [...set];
}

function requireNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new BadRequestException(`${name} is required`);
}
