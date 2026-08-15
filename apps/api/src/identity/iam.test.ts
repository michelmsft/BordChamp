import { BadRequestException } from "@nestjs/common";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { AuthService } from "./auth.service.js";
import { hashPassword } from "./credentials.js";
import type { Credential, IdentityRepository, Membership, UserProfile } from "./identity.repository.js";
import { IdentityService } from "./identity.service.js";
import type { TokenSigner } from "./token-signer.js";
import type { OrganizationRepository } from "../organizations/organization.repository.js";

const profile: UserProfile = {
  id: "user-1",
  email: "user@example.com",
  locale: "fr-CI",
  status: "active",
  onboardingState: "complete",
  sessionVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  etag: 'W/"1"',
};

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword("Password!2026");
});

function credential(mfaRequired: boolean): Credential {
  return {
    userId: profile.id,
    passwordHash,
    totpSecret: { ciphertext: "unused", nonce: "unused", tag: "unused" },
    mfaEnrolled: true,
    mfaRequired,
  };
}

function authService(mfaRequired: boolean): AuthService {
  const identities = {
    findByEmail: vi.fn().mockResolvedValue(profile),
    getCredential: vi.fn().mockResolvedValue(credential(mfaRequired)),
    saveRefreshToken: vi.fn().mockResolvedValue(undefined),
  } as unknown as IdentityRepository;
  const signer = {
    accessTokenTtlSeconds: 900,
    issueAccessToken: vi.fn().mockResolvedValue("access-token"),
  } as unknown as TokenSigner;
  return new AuthService(identities, signer);
}

describe("IAM authentication policy", () => {
  it("issues a session directly when MFA is not required", async () => {
    const result = await authService(false).login(profile.email, "Password!2026");

    expect(result.mfaRequired).toBe(false);
    expect(result).toMatchObject({ accessToken: "access-token", profile });
  });

  it("keeps the MFA challenge for users who require it", async () => {
    const result = await authService(true).login(profile.email, "Password!2026");

    expect(result.mfaRequired).toBe(true);
    expect(result).toHaveProperty("challengeToken");
  });

  it("does not allow MFA to be disabled for an ExchangeAdmin", async () => {
    const adminMembership: Membership = {
      userId: profile.id,
      organizationId: "org-1",
      role: "owner",
      personas: ["ExchangeAdmin"],
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
      etag: 'W/"1"',
    };
    const identities = {
      getProfile: vi.fn().mockResolvedValue(profile),
      listMemberships: vi.fn().mockResolvedValue([adminMembership]),
      listOrganizationMembers: vi.fn().mockResolvedValue([adminMembership]),
    } as unknown as IdentityRepository;
    const service = new IdentityService(identities, {} as OrganizationRepository);

    await expect(service.updateIamUser(profile.id, profile.id, { mfaRequired: false }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("resets a password and revokes existing sessions", async () => {
    const identities = {
      getProfile: vi.fn().mockResolvedValue(profile),
      listMemberships: vi.fn().mockResolvedValue([{ userId: "admin", organizationId: "org-1", role: "owner", personas: ["ExchangeAdmin"], status: "active" }]),
      setPasswordHash: vi.fn().mockResolvedValue(undefined),
      incrementSessionVersion: vi.fn().mockResolvedValue({ ...profile, sessionVersion: 2 }),
    } as unknown as IdentityRepository;
    const service = new IdentityService(identities, {} as OrganizationRepository);

    await service.resetIamPassword("admin", profile.id, "NewPassword!2026");

    expect(identities.setPasswordHash).toHaveBeenCalledWith(profile.id, expect.any(String));
    expect(identities.incrementSessionVersion).toHaveBeenCalledWith(profile.id);
  });

  it("does not allow an ExchangeAdmin to remove their own administrative persona", async () => {
    const adminMembership: Membership = {
      userId: profile.id,
      organizationId: "org-1",
      role: "owner",
      personas: ["ExchangeAdmin"],
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
      etag: 'W/"1"',
    };
    const identities = {
      getProfile: vi.fn().mockResolvedValue(profile),
      listMemberships: vi.fn().mockResolvedValue([adminMembership]),
      listOrganizationMembers: vi.fn().mockResolvedValue([adminMembership]),
    } as unknown as IdentityRepository;
    const service = new IdentityService(identities, {} as OrganizationRepository);

    await expect(service.updateIamMembership(profile.id, profile.id, "org-1", { personas: ["Trader"] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
