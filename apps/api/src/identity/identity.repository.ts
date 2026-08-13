import { randomBytes, randomUUID, createHash } from "node:crypto";

import type { Persona } from "@bordchamp/domain";
import type { TableClient, TableEntity } from "@azure/data-tables";

import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";
import type { EncryptedSecret } from "./credentials.js";
import { hashEmail, normalizeEmail } from "./credentials.js";

export const IDENTITY_REPOSITORY = Symbol("IDENTITY_REPOSITORY");

export type ProfileStatus = "active" | "suspended" | "inactive";
export type OnboardingState =
  | "pendingMfa"
  | "profileRequired"
  | "organizationRequired"
  | "complete";
export type MembershipRole = "owner" | "admin" | "member";
export type MembershipStatus = "active" | "suspended" | "revoked";

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName?: string;
  readonly givenName?: string;
  readonly surname?: string;
  readonly locale: string;
  readonly status: ProfileStatus;
  readonly onboardingState: OnboardingState;
  readonly sessionVersion: number;
  readonly preferredOrganizationId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly etag: string;
}

export interface Credential {
  readonly userId: string;
  readonly passwordHash: string;
  readonly totpSecret: EncryptedSecret;
  readonly mfaEnrolled: boolean;
}

export interface RefreshTokenRecord {
  readonly userId: string;
  readonly tokenId: string;
  readonly familyId: string;
  readonly tokenHash: string;
  readonly status: "active" | "rotated" | "revoked";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly replacedByTokenId?: string;
}

export interface RecoveryCodeRecord {
  readonly userId: string;
  readonly codeId: string;
  readonly codeHash: string;
  readonly consumedAt?: string;
}

export interface CreateAccountInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly totpSecret: EncryptedSecret;
}

export interface Membership {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: MembershipRole;
  readonly personas: readonly Persona[];
  readonly status: MembershipStatus;
  readonly joinedAt: string;
  readonly etag: string;
}

export interface Invitation {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly personas: readonly Persona[];
  readonly status: "pending" | "accepted" | "revoked" | "expired";
  readonly expiresAt: string;
  readonly invitedByUserId: string;
  readonly createdAt: string;
  readonly etag: string;
}

export interface CreateInvitationResult {
  readonly invitation: Invitation;
  readonly secret: string;
}

export interface ProfileChanges {
  readonly displayName?: string;
  readonly givenName?: string;
  readonly surname?: string;
  readonly locale?: string;
  readonly onboardingState?: OnboardingState;
}

export interface MembershipChanges {
  readonly role?: MembershipRole;
  readonly personas?: readonly Persona[];
  readonly status?: MembershipStatus;
}

export interface CreateInvitationInput {
  readonly organizationId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly personas: readonly Persona[];
  readonly expiresAt: string;
  readonly invitedByUserId: string;
}

export class IdentityConflictError extends Error {}
export class IdentityNotFoundError extends Error {}
export class EmailAlreadyRegisteredError extends Error {}

export interface IdentityRepository {
  createAccount(input: CreateAccountInput): Promise<UserProfile>;
  ensureTestProfile(userId: string, email: string): Promise<UserProfile>;
  findByEmail(email: string): Promise<UserProfile | undefined>;
  getProfile(userId: string): Promise<UserProfile | undefined>;
  updateProfile(userId: string, changes: ProfileChanges, etag: string): Promise<UserProfile>;
  incrementSessionVersion(userId: string): Promise<UserProfile>;
  getCredential(userId: string): Promise<Credential | undefined>;
  markMfaEnrolled(userId: string): Promise<void>;
  saveRefreshToken(record: RefreshTokenRecord): Promise<void>;
  getRefreshToken(userId: string, tokenId: string): Promise<RefreshTokenRecord | undefined>;
  markRefreshTokenRotated(userId: string, tokenId: string, replacementId: string): Promise<void>;
  revokeRefreshFamily(userId: string, familyId: string): Promise<void>;
  saveRecoveryCodes(userId: string, codes: readonly RecoveryCodeRecord[]): Promise<void>;
  findRecoveryCodeByHash(userId: string, codeHash: string): Promise<RecoveryCodeRecord | undefined>;
  markRecoveryCodeConsumed(userId: string, codeId: string): Promise<void>;
  listMemberships(userId: string): Promise<readonly Membership[]>;
  addMembership(membership: Omit<Membership, "etag">): Promise<Membership>;
  setPreferredOrganization(userId: string, organizationId: string, etag: string): Promise<UserProfile>;
  listOrganizationMembers(organizationId: string): Promise<readonly Membership[]>;
  updateMembership(organizationId: string, userId: string, changes: MembershipChanges, etag: string): Promise<Membership>;
  createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult>;
  listInvitations(organizationId: string): Promise<readonly Invitation[]>;
  acceptInvitation(organizationId: string, invitationId: string, secret: string, userId: string): Promise<Membership>;
  revokeInvitation(organizationId: string, invitationId: string, etag: string): Promise<Invitation>;
}

class InMemoryIdentityRepository implements IdentityRepository {
  private readonly profiles = new Map<string, UserProfile>();
  private readonly emailIndex = new Map<string, string>();
  private readonly credentials = new Map<string, Credential>();
  private readonly refresh = new Map<string, RefreshTokenRecord>();
  private readonly recovery = new Map<string, RecoveryCodeRecord[]>();
  private readonly memberships = new Map<string, Membership>();
  private readonly invitations = new Map<string, Invitation & { tokenHash: string }>();
  private version = 0;

  async createAccount(input: CreateAccountInput): Promise<UserProfile> {
    const emailKey = hashEmail(input.email);
    if (this.emailIndex.has(emailKey)) throw new EmailAlreadyRegisteredError("Email is already registered");
    const now = new Date().toISOString();
    const profile: UserProfile = {
      id: randomUUID(),
      email: normalizeEmail(input.email),
      locale: "fr-CI",
      status: "active",
      onboardingState: "pendingMfa",
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
      etag: this.nextEtag(),
    };
    this.profiles.set(profile.id, profile);
    this.emailIndex.set(emailKey, profile.id);
    this.credentials.set(profile.id, {
      userId: profile.id,
      passwordHash: input.passwordHash,
      totpSecret: input.totpSecret,
      mfaEnrolled: false,
    });
    return profile;
  }

  async ensureTestProfile(userId: string, email: string): Promise<UserProfile> {
    const existing = this.profiles.get(userId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const profile: UserProfile = {
      id: userId,
      email: normalizeEmail(email),
      locale: "fr-CI",
      status: "active",
      onboardingState: "profileRequired",
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
      etag: this.nextEtag(),
    };
    this.profiles.set(userId, profile);
    this.emailIndex.set(hashEmail(email), userId);
    return profile;
  }

  async findByEmail(email: string) {
    const userId = this.emailIndex.get(hashEmail(email));
    return userId === undefined ? undefined : this.profiles.get(userId);
  }

  async getProfile(userId: string) {
    return this.profiles.get(userId);
  }

  async updateProfile(userId: string, changes: ProfileChanges, etag: string) {
    const current = this.requireProfile(userId);
    this.checkEtag(current.etag, etag);
    const next: UserProfile = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.profiles.set(userId, next);
    return next;
  }

  async incrementSessionVersion(userId: string) {
    const current = this.requireProfile(userId);
    const next: UserProfile = {
      ...current,
      sessionVersion: current.sessionVersion + 1,
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.profiles.set(userId, next);
    return next;
  }

  async getCredential(userId: string) {
    return this.credentials.get(userId);
  }

  async markMfaEnrolled(userId: string) {
    const current = this.credentials.get(userId);
    if (!current) throw new IdentityNotFoundError("Credential not found");
    this.credentials.set(userId, { ...current, mfaEnrolled: true });
  }

  async saveRefreshToken(record: RefreshTokenRecord) {
    this.refresh.set(refreshKey(record.userId, record.tokenId), record);
  }

  async getRefreshToken(userId: string, tokenId: string) {
    return this.refresh.get(refreshKey(userId, tokenId));
  }

  async markRefreshTokenRotated(userId: string, tokenId: string, replacementId: string) {
    const current = this.refresh.get(refreshKey(userId, tokenId));
    if (!current) return;
    this.refresh.set(refreshKey(userId, tokenId), {
      ...current,
      status: "rotated",
      replacedByTokenId: replacementId,
    });
  }

  async revokeRefreshFamily(userId: string, familyId: string) {
    for (const [key, record] of this.refresh) {
      if (record.userId === userId && record.familyId === familyId && record.status !== "revoked") {
        this.refresh.set(key, { ...record, status: "revoked" });
      }
    }
  }

  async saveRecoveryCodes(userId: string, codes: readonly RecoveryCodeRecord[]) {
    this.recovery.set(userId, [...codes]);
  }

  async findRecoveryCodeByHash(userId: string, codeHash: string) {
    return this.recovery.get(userId)?.find(value => value.codeHash === codeHash && value.consumedAt === undefined);
  }

  async markRecoveryCodeConsumed(userId: string, codeId: string) {
    const codes = this.recovery.get(userId);
    if (!codes) return;
    this.recovery.set(
      userId,
      codes.map(value => value.codeId === codeId ? { ...value, consumedAt: new Date().toISOString() } : value),
    );
  }

  async listMemberships(userId: string) {
    return [...this.memberships.values()].filter(value => value.userId === userId);
  }

  async addMembership(input: Omit<Membership, "etag">) {
    const key = membershipKey(input.organizationId, input.userId);
    const existing = this.memberships.get(key);
    if (existing) return existing;
    const value: Membership = { ...input, etag: this.nextEtag() };
    this.memberships.set(key, value);
    return value;
  }

  async setPreferredOrganization(userId: string, organizationId: string, etag: string) {
    const current = this.requireProfile(userId);
    this.checkEtag(current.etag, etag);
    const next: UserProfile = {
      ...current,
      preferredOrganizationId: organizationId,
      onboardingState: "complete",
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.profiles.set(userId, next);
    return next;
  }

  async listOrganizationMembers(organizationId: string) {
    return [...this.memberships.values()].filter(value => value.organizationId === organizationId);
  }

  async updateMembership(organizationId: string, userId: string, changes: MembershipChanges, etag: string) {
    const key = membershipKey(organizationId, userId);
    const current = this.memberships.get(key);
    if (!current) throw new IdentityNotFoundError("Membership not found");
    this.checkEtag(current.etag, etag);
    const next: Membership = { ...current, ...changes, etag: this.nextEtag() };
    this.memberships.set(key, next);
    return next;
  }

  async createInvitation(input: CreateInvitationInput) {
    const secret = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const invitation: Invitation & { tokenHash: string } = {
      id: randomUUID(),
      ...input,
      status: "pending",
      createdAt: now,
      tokenHash: sha256(secret),
      etag: this.nextEtag(),
    };
    this.invitations.set(invitationKey(input.organizationId, invitation.id), invitation);
    return { invitation: stripHash(invitation), secret };
  }

  async listInvitations(organizationId: string) {
    return [...this.invitations.values()]
      .filter(value => value.organizationId === organizationId)
      .map(stripHash);
  }

  async acceptInvitation(organizationId: string, invitationId: string, secret: string, userId: string) {
    const invitation = this.requireInvitation(organizationId, invitationId);
    validateInvitation(invitation, secret);
    const membership = await this.addMembership({
      userId,
      organizationId,
      role: invitation.role,
      personas: invitation.personas,
      status: "active",
      joinedAt: new Date().toISOString(),
    });
    this.invitations.set(invitationKey(organizationId, invitationId), {
      ...invitation,
      status: "accepted",
      etag: this.nextEtag(),
    });
    return membership;
  }

  async revokeInvitation(organizationId: string, invitationId: string, etag: string) {
    const current = this.requireInvitation(organizationId, invitationId);
    this.checkEtag(current.etag, etag);
    const next = { ...current, status: "revoked" as const, etag: this.nextEtag() };
    this.invitations.set(invitationKey(organizationId, invitationId), next);
    return stripHash(next);
  }

  private requireProfile(id: string): UserProfile {
    const value = this.profiles.get(id);
    if (!value) throw new IdentityNotFoundError("Profile not found");
    return value;
  }

  private requireInvitation(org: string, id: string) {
    const value = this.invitations.get(invitationKey(org, id));
    if (!value) throw new IdentityNotFoundError("Invitation not found");
    return value;
  }

  private checkEtag(actual: string, expected: string) {
    if (actual !== expected) throw new IdentityConflictError("Identity record changed");
  }

  private nextEtag() {
    this.version += 1;
    return `W/"${this.version}"`;
  }
}

interface ProfileEntity extends TableEntity {
  email: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  locale: string;
  status: ProfileStatus;
  onboardingState: OnboardingState;
  sessionVersion: number;
  preferredOrganizationId?: string;
  createdAt: string;
  updatedAt: string;
}

class AzureTableIdentityRepository implements IdentityRepository {
  constructor(
    private readonly users: TableClient,
    private readonly organizations: TableClient,
  ) {}

  async createAccount(input: CreateAccountInput): Promise<UserProfile> {
    const emailHash = hashEmail(input.email);
    try {
      const lookup = await this.users.getEntity<TableEntity & { userId: string }>("LOGIN", `EMAIL:${emailHash}`);
      if (lookup.userId) throw new EmailAlreadyRegisteredError("Email is already registered");
    } catch (error: unknown) {
      if (!isStatus(error, 404)) throw error;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.users.createEntity({
      partitionKey: "LOGIN",
      rowKey: `EMAIL:${emailHash}`,
      userId: id,
      createdAt: now,
    });
    const profileEntity: ProfileEntity = {
      partitionKey: id,
      rowKey: "PROFILE",
      email: normalizeEmail(input.email),
      locale: "fr-CI",
      status: "active",
      onboardingState: "pendingMfa",
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.users.createEntity(profileEntity);
    await this.users.createEntity({
      partitionKey: id,
      rowKey: "CREDENTIAL",
      passwordHash: input.passwordHash,
      totpCiphertext: input.totpSecret.ciphertext,
      totpNonce: input.totpSecret.nonce,
      totpTag: input.totpSecret.tag,
      mfaEnrolled: false,
    });
    return this.requireProfile(id);
  }

  async ensureTestProfile(userId: string, email: string): Promise<UserProfile> {
    const existing = await this.getProfile(userId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const profileEntity: ProfileEntity = {
      partitionKey: userId,
      rowKey: "PROFILE",
      email: normalizeEmail(email),
      locale: "fr-CI",
      status: "active",
      onboardingState: "profileRequired",
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.users.upsertEntity(profileEntity, "Replace");
    await this.users.upsertEntity({
      partitionKey: "LOGIN",
      rowKey: `EMAIL:${hashEmail(email)}`,
      userId,
      createdAt: now,
    }, "Replace");
    return this.requireProfile(userId);
  }

  async findByEmail(email: string) {
    try {
      const lookup = await this.users.getEntity<TableEntity & { userId: string }>("LOGIN", `EMAIL:${hashEmail(email)}`);
      return await this.getProfile(lookup.userId);
    } catch (error: unknown) {
      if (isStatus(error, 404)) return undefined;
      throw error;
    }
  }

  async getProfile(userId: string) {
    try {
      return toProfile(await this.users.getEntity<ProfileEntity>(userId, "PROFILE"));
    } catch (error: unknown) {
      if (isStatus(error, 404)) return undefined;
      throw error;
    }
  }

  async updateProfile(userId: string, changes: ProfileChanges, etag: string) {
    const current = await this.requireProfile(userId);
    const entity = profileToEntity({ ...current, ...changes, updatedAt: new Date().toISOString() });
    await this.replace(entity, etag);
    return this.requireProfile(userId);
  }

  async incrementSessionVersion(userId: string) {
    const current = await this.requireProfile(userId);
    const entity = profileToEntity({
      ...current,
      sessionVersion: current.sessionVersion + 1,
      updatedAt: new Date().toISOString(),
    });
    await this.replace(entity, current.etag);
    return this.requireProfile(userId);
  }

  async getCredential(userId: string): Promise<Credential | undefined> {
    try {
      const entity = await this.users.getEntity<TableEntity & Record<string, unknown>>(userId, "CREDENTIAL");
      return {
        userId,
        passwordHash: entity.passwordHash as string,
        totpSecret: {
          ciphertext: entity.totpCiphertext as string,
          nonce: entity.totpNonce as string,
          tag: entity.totpTag as string,
        },
        mfaEnrolled: entity.mfaEnrolled === true,
      };
    } catch (error: unknown) {
      if (isStatus(error, 404)) return undefined;
      throw error;
    }
  }

  async markMfaEnrolled(userId: string) {
    await this.users.updateEntity({ partitionKey: userId, rowKey: "CREDENTIAL", mfaEnrolled: true }, "Merge");
  }

  async saveRefreshToken(record: RefreshTokenRecord) {
    await this.users.upsertEntity({
      partitionKey: record.userId,
      rowKey: `REFRESH:${record.tokenId}`,
      tokenId: record.tokenId,
      familyId: record.familyId,
      tokenHash: record.tokenHash,
      status: record.status,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      ...(record.replacedByTokenId === undefined ? {} : { replacedByTokenId: record.replacedByTokenId }),
    }, "Replace");
  }

  async getRefreshToken(userId: string, tokenId: string) {
    try {
      const entity = await this.users.getEntity<TableEntity & Record<string, unknown>>(userId, `REFRESH:${tokenId}`);
      return {
        userId,
        tokenId: entity.tokenId as string,
        familyId: entity.familyId as string,
        tokenHash: entity.tokenHash as string,
        status: entity.status as RefreshTokenRecord["status"],
        issuedAt: entity.issuedAt as string,
        expiresAt: entity.expiresAt as string,
        ...(entity.replacedByTokenId === undefined ? {} : { replacedByTokenId: entity.replacedByTokenId as string }),
      };
    } catch (error: unknown) {
      if (isStatus(error, 404)) return undefined;
      throw error;
    }
  }

  async markRefreshTokenRotated(userId: string, tokenId: string, replacementId: string) {
    await this.users.updateEntity({
      partitionKey: userId,
      rowKey: `REFRESH:${tokenId}`,
      status: "rotated",
      replacedByTokenId: replacementId,
    }, "Merge");
  }

  async revokeRefreshFamily(userId: string, familyId: string) {
    for await (const entity of this.users.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${escapeFilter(userId)}' and RowKey ge 'REFRESH:' and RowKey lt 'REFRESI:'`,
      },
    })) {
      const record = entity as TableEntity & Record<string, unknown>;
      if (record.familyId === familyId && record.status !== "revoked") {
        await this.users.updateEntity({
          partitionKey: userId,
          rowKey: record.rowKey,
          status: "revoked",
        }, "Merge");
      }
    }
  }

  async saveRecoveryCodes(userId: string, codes: readonly RecoveryCodeRecord[]) {
    for (const code of codes) {
      await this.users.upsertEntity({
        partitionKey: userId,
        rowKey: `RECOVERY:${code.codeId}`,
        codeId: code.codeId,
        codeHash: code.codeHash,
        ...(code.consumedAt === undefined ? {} : { consumedAt: code.consumedAt }),
      }, "Replace");
    }
  }

  async findRecoveryCodeByHash(userId: string, codeHash: string) {
    for await (const entity of this.users.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${escapeFilter(userId)}' and RowKey ge 'RECOVERY:' and RowKey lt 'RECOVERZ:'`,
      },
    })) {
      const record = entity as TableEntity & Record<string, unknown>;
      if (record.codeHash === codeHash && record.consumedAt === undefined) {
        return {
          userId,
          codeId: record.codeId as string,
          codeHash: record.codeHash as string,
        };
      }
    }
    return undefined;
  }

  async markRecoveryCodeConsumed(userId: string, codeId: string) {
    await this.users.updateEntity({
      partitionKey: userId,
      rowKey: `RECOVERY:${codeId}`,
      consumedAt: new Date().toISOString(),
    }, "Merge");
  }

  async listMemberships(userId: string) {
    const output: Membership[] = [];
    for await (const entity of this.users.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${escapeFilter(userId)}' and RowKey ge 'MEMBER:' and RowKey lt 'MEMBES:'`,
      },
    })) output.push(toMembership(entity as TableEntity & Record<string, unknown>));
    return output;
  }

  async addMembership(input: Omit<Membership, "etag">) {
    const userEntity = membershipEntity(input, input.userId);
    const orgEntity = membershipEntity(input, input.organizationId);
    await this.organizations.upsertEntity(orgEntity, "Replace");
    await this.users.upsertEntity(userEntity, "Replace");
    return this.requireMembership(input.organizationId, input.userId);
  }

  async setPreferredOrganization(userId: string, organizationId: string, etag: string) {
    const current = await this.requireProfile(userId);
    const entity = profileToEntity({
      ...current,
      preferredOrganizationId: organizationId,
      onboardingState: "complete",
      updatedAt: new Date().toISOString(),
    });
    await this.replace(entity, etag);
    return this.requireProfile(userId);
  }

  async listOrganizationMembers(organizationId: string) {
    const output: Membership[] = [];
    for await (const entity of this.organizations.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${escapeFilter(organizationId)}' and RowKey ge 'MEMBER:' and RowKey lt 'MEMBES:'`,
      },
    })) output.push(toMembership(entity as TableEntity & Record<string, unknown>));
    return output;
  }

  async updateMembership(organizationId: string, userId: string, changes: MembershipChanges, etag: string) {
    const current = await this.requireMembership(organizationId, userId);
    const next = { ...current, ...changes };
    try {
      await this.organizations.updateEntity(membershipEntity(next, organizationId), "Replace", { etag });
    } catch (error: unknown) {
      if (isStatus(error, 409) || isStatus(error, 412)) throw new IdentityConflictError("Identity record changed");
      throw error;
    }
    await this.users.upsertEntity(membershipEntity(next, userId), "Replace");
    return this.requireMembership(organizationId, userId);
  }

  async createInvitation(input: CreateInvitationInput) {
    const secret = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const id = randomUUID();
    await this.organizations.createEntity({
      partitionKey: input.organizationId,
      rowKey: `INVITE:${id}`,
      invitationId: id,
      email: input.email,
      emailHash: sha256(input.email.toLowerCase()),
      tokenHash: sha256(secret),
      role: input.role,
      personasJson: JSON.stringify(input.personas),
      status: "pending",
      expiresAt: input.expiresAt,
      invitedByUserId: input.invitedByUserId,
      createdAt: now,
    });
    return {
      invitation: await this.requireInvitation(input.organizationId, id).then(stripHash),
      secret,
    };
  }

  async listInvitations(organizationId: string) {
    const output: Invitation[] = [];
    for await (const entity of this.organizations.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${escapeFilter(organizationId)}' and RowKey ge 'INVITE:' and RowKey lt 'INVITF:'`,
      },
    })) output.push(stripHash(toInvitation(entity as TableEntity & Record<string, unknown>)));
    return output;
  }

  async acceptInvitation(organizationId: string, invitationId: string, secret: string, userId: string) {
    const invitation = await this.requireInvitation(organizationId, invitationId);
    validateInvitation(invitation, secret);
    const membership = await this.addMembership({
      userId,
      organizationId,
      role: invitation.role,
      personas: invitation.personas,
      status: "active",
      joinedAt: new Date().toISOString(),
    });
    await this.organizations.updateEntity(
      { partitionKey: organizationId, rowKey: `INVITE:${invitationId}`, status: "accepted" },
      "Merge",
      { etag: invitation.etag },
    );
    return membership;
  }

  async revokeInvitation(organizationId: string, invitationId: string, etag: string) {
    try {
      await this.organizations.updateEntity(
        { partitionKey: organizationId, rowKey: `INVITE:${invitationId}`, status: "revoked" },
        "Merge",
        { etag },
      );
    } catch (error: unknown) {
      if (isStatus(error, 409) || isStatus(error, 412)) throw new IdentityConflictError("Identity record changed");
      throw error;
    }
    return this.requireInvitation(organizationId, invitationId).then(stripHash);
  }

  private async requireProfile(id: string): Promise<UserProfile> {
    const value = await this.getProfile(id);
    if (!value) throw new IdentityNotFoundError("Profile not found");
    return value;
  }

  private async requireMembership(org: string, user: string): Promise<Membership> {
    try {
      return toMembership(await this.organizations.getEntity(org, `MEMBER:${user}`) as TableEntity & Record<string, unknown>);
    } catch (error: unknown) {
      if (isStatus(error, 404)) throw new IdentityNotFoundError("Membership not found");
      throw error;
    }
  }

  private async requireInvitation(org: string, id: string) {
    try {
      return toInvitation(await this.organizations.getEntity(org, `INVITE:${id}`) as TableEntity & Record<string, unknown>);
    } catch (error: unknown) {
      if (isStatus(error, 404)) throw new IdentityNotFoundError("Invitation not found");
      throw error;
    }
  }

  private async replace(entity: ProfileEntity, etag: string) {
    try {
      await this.users.updateEntity(entity, "Replace", { etag });
    } catch (error: unknown) {
      if (isStatus(error, 409) || isStatus(error, 412)) throw new IdentityConflictError("Identity record changed");
      throw error;
    }
  }
}

export function createIdentityRepository(): IdentityRepository {
  if (!hasTableStorageConfiguration()) return new InMemoryIdentityRepository();
  return new AzureTableIdentityRepository(
    createTableClient(process.env.AZURE_STORAGE_USER_DIRECTORY_TABLE ?? "UserDirectory"),
    createTableClient(process.env.AZURE_STORAGE_ORGANIZATIONS_TABLE ?? "Organizations"),
  );
}

function toProfile(entity: ProfileEntity & { etag?: string }): UserProfile {
  return {
    id: entity.partitionKey,
    email: entity.email,
    ...(entity.displayName === undefined ? {} : { displayName: entity.displayName }),
    ...(entity.givenName === undefined ? {} : { givenName: entity.givenName }),
    ...(entity.surname === undefined ? {} : { surname: entity.surname }),
    locale: entity.locale,
    status: entity.status,
    onboardingState: entity.onboardingState,
    sessionVersion: Number(entity.sessionVersion),
    ...(entity.preferredOrganizationId === undefined ? {} : { preferredOrganizationId: entity.preferredOrganizationId }),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    etag: entity.etag ?? "",
  };
}

function profileToEntity(profile: UserProfile): ProfileEntity {
  return {
    partitionKey: profile.id,
    rowKey: "PROFILE",
    email: profile.email,
    ...(profile.displayName === undefined ? {} : { displayName: profile.displayName }),
    ...(profile.givenName === undefined ? {} : { givenName: profile.givenName }),
    ...(profile.surname === undefined ? {} : { surname: profile.surname }),
    locale: profile.locale,
    status: profile.status,
    onboardingState: profile.onboardingState,
    sessionVersion: profile.sessionVersion,
    ...(profile.preferredOrganizationId === undefined ? {} : { preferredOrganizationId: profile.preferredOrganizationId }),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function membershipEntity(value: Omit<Membership, "etag"> | Membership, partitionKey: string): TableEntity {
  return {
    partitionKey,
    rowKey: `MEMBER:${partitionKey === value.userId ? value.organizationId : value.userId}`,
    userId: value.userId,
    organizationId: value.organizationId,
    role: value.role,
    personasJson: JSON.stringify(value.personas),
    status: value.status,
    joinedAt: value.joinedAt,
  };
}

function toMembership(entity: TableEntity & Record<string, unknown>): Membership {
  return {
    userId: entity.userId as string,
    organizationId: entity.organizationId as string,
    role: entity.role as MembershipRole,
    personas: JSON.parse(entity.personasJson as string) as Persona[],
    status: entity.status as MembershipStatus,
    joinedAt: entity.joinedAt as string,
    etag: (entity.etag as string) ?? "",
  };
}

function toInvitation(entity: TableEntity & Record<string, unknown>): Invitation & { tokenHash: string } {
  return {
    id: entity.invitationId as string,
    organizationId: entity.partitionKey,
    email: entity.email as string,
    role: entity.role as MembershipRole,
    personas: JSON.parse(entity.personasJson as string) as Persona[],
    status: entity.status as Invitation["status"],
    expiresAt: entity.expiresAt as string,
    invitedByUserId: entity.invitedByUserId as string,
    createdAt: entity.createdAt as string,
    tokenHash: entity.tokenHash as string,
    etag: (entity.etag as string) ?? "",
  };
}

function stripHash<T extends Invitation & { tokenHash: string }>(value: T): Invitation {
  const { tokenHash: _tokenHash, ...invitation } = value;
  return invitation;
}

function validateInvitation(value: Invitation & { tokenHash: string }, secret: string): void {
  if (value.status !== "pending" || value.expiresAt <= new Date().toISOString() || value.tokenHash !== sha256(secret)) {
    throw new IdentityConflictError("Invitation is invalid or expired");
  }
}

function refreshKey(userId: string, tokenId: string) {
  return `${userId}:${tokenId}`;
}

function membershipKey(org: string, user: string) {
  return `${org}:${user}`;
}

function invitationKey(org: string, id: string) {
  return `${org}:${id}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeFilter(value: string) {
  return value.replaceAll("'", "''");
}

function isStatus(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && (error as { statusCode: number }).statusCode === code;
}
