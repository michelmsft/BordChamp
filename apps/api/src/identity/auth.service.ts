import { Inject, Injectable, UnauthorizedException, BadRequestException, ConflictException } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import { createSecretKey, randomBytes, createHmac } from "node:crypto";

import {
  EmailAlreadyRegisteredError,
  IDENTITY_REPOSITORY,
  type IdentityRepository,
  type RecoveryCodeRecord,
  type UserProfile,
} from "./identity.repository.js";
import {
  decryptSecret,
  encryptSecret,
  generateEnrollment,
  generateRecoveryCodes,
  hashPassword,
  hashRecovery,
  hashRefreshSecret,
  issueRefreshToken,
  normalizeEmail,
  parseRefreshToken,
  safeEqual,
  verifyPassword,
  verifyTotp,
} from "./credentials.js";
import { TOKEN_SIGNER, type TokenSigner } from "./token-signer.js";

const REFRESH_COOKIE_NAME = "bc_refresh";
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ENROLLMENT_TTL = "5m";
const CHALLENGE_TTL = "2m";
const CHALLENGE_ISSUER = "bordchamp";
const CHALLENGE_AUDIENCE = "bordchamp-auth";

export interface RegisterResult {
  readonly enrollmentToken: string;
  readonly otpauthUri: string;
  readonly secretBase32: string;
}

export interface AuthenticationResult {
  readonly accessToken: string;
  readonly refreshCookie: RefreshCookie;
  readonly profile: UserProfile;
}

export interface RefreshCookie {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds: number;
}

export interface RegistrationCompletion extends AuthenticationResult {
  readonly recoveryCodes: readonly string[];
}

@Injectable()
export class AuthService {
  private readonly challengeKey = createSecretKey(getChallengeKey());

  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSigner,
  ) {}

  async register(email: string, password: string): Promise<RegisterResult> {
    const normalized = validateEmail(email);
    validatePasswordStrength(password);
    const enrollment = generateEnrollment(normalized);
    const passwordHash = await hashPassword(password);
    const totpSecret = encryptSecret(enrollment.secretBase32);
    let profile: UserProfile;
    try {
      profile = await this.identities.createAccount({ email: normalized, passwordHash, totpSecret });
    } catch (error: unknown) {
      if (error instanceof EmailAlreadyRegisteredError) throw new ConflictException("Email is already registered");
      throw error;
    }
    const enrollmentToken = await this.signChallenge({ sub: profile.id, purpose: "enrollment" }, ENROLLMENT_TTL);
    return { enrollmentToken, otpauthUri: enrollment.otpauthUri, secretBase32: enrollment.secretBase32 };
  }

  async verifyRegistration(enrollmentToken: string, code: string): Promise<RegistrationCompletion> {
    const { sub } = await this.consumeChallenge(enrollmentToken, "enrollment");
    const credential = await this.identities.getCredential(sub);
    if (!credential) throw new UnauthorizedException("Enrollment session is invalid");
    if (!verifyTotp(decryptSecret(credential.totpSecret), code)) throw new UnauthorizedException("Authenticator code is invalid");
    await this.identities.markMfaEnrolled(sub);
    const profile = await this.identities.getProfile(sub);
    if (!profile) throw new UnauthorizedException("Profile not found");
    const updated = profile.onboardingState === "pendingMfa"
      ? await this.identities.updateProfile(sub, { onboardingState: "profileRequired" }, profile.etag)
      : profile;
    const codes = generateRecoveryCodes();
    const records: RecoveryCodeRecord[] = codes.map(entry => ({ userId: sub, codeId: entry.id, codeHash: entry.hash }));
    await this.identities.saveRecoveryCodes(sub, records);
    const session = await this.issueSession(updated);
    return { ...session, recoveryCodes: codes.map(value => value.plaintext) };
  }

  async login(email: string, password: string): Promise<
    | { readonly mfaRequired: true; readonly challengeToken: string }
    | ({ readonly mfaRequired: false } & AuthenticationResult)
  > {
    const profile = await this.identities.findByEmail(email);
    const credential = profile ? await this.identities.getCredential(profile.id) : undefined;
    const authenticated = credential !== undefined && await verifyPassword(credential.passwordHash, password);
    if (!authenticated || !profile || profile.status !== "active") {
      await hashPassword(randomBytes(16).toString("hex"));
      throw new UnauthorizedException("Email or password is incorrect");
    }
    if (!credential.mfaRequired) return { mfaRequired: false, ...await this.issueSession(profile) };
    if (!credential.mfaEnrolled) throw new UnauthorizedException("Authenticator enrollment is required");
    const challengeToken = await this.signChallenge({ sub: profile.id, purpose: "mfa" }, CHALLENGE_TTL);
    return { mfaRequired: true, challengeToken };
  }

  async verifyLogin(challengeToken: string, code: string, mode: "totp" | "recovery"): Promise<AuthenticationResult> {
    const { sub } = await this.consumeChallenge(challengeToken, "mfa");
    const credential = await this.identities.getCredential(sub);
    if (!credential) throw new UnauthorizedException("Login session is invalid");
    if (mode === "totp") {
      if (!verifyTotp(decryptSecret(credential.totpSecret), code)) throw new UnauthorizedException("Authenticator code is invalid");
    } else {
      const codeHash = hashRecovery(code);
      const record = await this.identities.findRecoveryCodeByHash(sub, codeHash);
      if (!record) throw new UnauthorizedException("Recovery code is invalid or already used");
      await this.identities.markRecoveryCodeConsumed(sub, record.codeId);
    }
    const profile = await this.identities.getProfile(sub);
    if (!profile) throw new UnauthorizedException("Profile not found");
    return this.issueSession(profile);
  }

  async refresh(cookieHeader: string | undefined): Promise<AuthenticationResult> {
    const raw = readRefreshCookie(cookieHeader);
    const parsed = raw === undefined ? null : parseRefreshToken(raw);
    if (!parsed) throw new UnauthorizedException("Refresh token is missing");
    const record = await this.identities.getRefreshToken(parsed.userId, parsed.tokenId);
    if (!record) throw new UnauthorizedException("Refresh token is invalid");
    if (!safeEqual(record.tokenHash, hashRefreshSecret(parsed.secret))) throw new UnauthorizedException("Refresh token is invalid");
    if (record.status !== "active") {
      await this.identities.revokeRefreshFamily(record.userId, record.familyId);
      throw new UnauthorizedException("Refresh token has been revoked");
    }
    if (record.expiresAt <= new Date().toISOString()) throw new UnauthorizedException("Refresh token has expired");
    const profile = await this.identities.getProfile(record.userId);
    if (!profile || profile.status !== "active") throw new UnauthorizedException("Profile is not active");
    const next = issueRefreshToken(profile.id, record.familyId);
    const now = new Date();
    await this.identities.saveRefreshToken({
      userId: profile.id,
      tokenId: next.tokenId,
      familyId: next.familyId,
      tokenHash: next.hash,
      status: "active",
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000).toISOString(),
    });
    await this.identities.markRefreshTokenRotated(profile.id, record.tokenId, next.tokenId);
    const accessToken = await this.signer.issueAccessToken({ userId: profile.id, sessionVersion: profile.sessionVersion });
    return {
      accessToken,
      refreshCookie: { name: REFRESH_COOKIE_NAME, value: next.plaintext, maxAgeSeconds: REFRESH_TTL_SECONDS },
      profile,
    };
  }

  async logout(cookieHeader: string | undefined): Promise<{ readonly clearCookie: string }> {
    const raw = readRefreshCookie(cookieHeader);
    const parsed = raw === undefined ? null : parseRefreshToken(raw);
    if (parsed) {
      const record = await this.identities.getRefreshToken(parsed.userId, parsed.tokenId);
      if (record) await this.identities.revokeRefreshFamily(record.userId, record.familyId);
    }
    return { clearCookie: REFRESH_COOKIE_NAME };
  }

  static cookieName(): string {
    return REFRESH_COOKIE_NAME;
  }

  private async issueSession(profile: UserProfile): Promise<AuthenticationResult> {
    const refresh = issueRefreshToken(profile.id);
    const now = new Date();
    await this.identities.saveRefreshToken({
      userId: profile.id,
      tokenId: refresh.tokenId,
      familyId: refresh.familyId,
      tokenHash: refresh.hash,
      status: "active",
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000).toISOString(),
    });
    const accessToken = await this.signer.issueAccessToken({ userId: profile.id, sessionVersion: profile.sessionVersion });
    return {
      accessToken,
      refreshCookie: { name: REFRESH_COOKIE_NAME, value: refresh.plaintext, maxAgeSeconds: REFRESH_TTL_SECONDS },
      profile,
    };
  }

  private async signChallenge(payload: { sub: string; purpose: "enrollment" | "mfa" }, ttl: string): Promise<string> {
    return new SignJWT({ purpose: payload.purpose })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(payload.sub)
      .setIssuer(CHALLENGE_ISSUER)
      .setAudience(CHALLENGE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(this.challengeKey);
  }

  private async consumeChallenge(token: string, purpose: "enrollment" | "mfa"): Promise<{ sub: string }> {
    try {
      const { payload } = await jwtVerify(token, this.challengeKey, {
        algorithms: ["HS256"],
        issuer: CHALLENGE_ISSUER,
        audience: CHALLENGE_AUDIENCE,
      });
      if (payload.purpose !== purpose) throw new Error("Invalid challenge purpose");
      if (typeof payload.sub !== "string" || payload.sub.length === 0) throw new Error("Invalid challenge subject");
      return { sub: payload.sub };
    } catch {
      throw new UnauthorizedException("Session challenge is invalid or expired");
    }
  }
}

function validateEmail(value: string): string {
  const normalized = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) throw new BadRequestException("Email is invalid");
  return normalized;
}

export function validatePasswordStrength(password: string): void {
  if (typeof password !== "string" || password.length < 10) throw new BadRequestException("Password must be at least 10 characters");
  const hasLetter = /[A-Za-z]/u.test(password);
  const hasDigit = /\d/u.test(password);
  const hasSymbol = /[^A-Za-z0-9]/u.test(password);
  if (!hasLetter || !hasDigit || !hasSymbol) throw new BadRequestException("Password must include letters, digits, and a symbol");
}

function readRefreshCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const segment of header.split(";")) {
    const [name, ...rest] = segment.trim().split("=");
    if (name === REFRESH_COOKIE_NAME && rest.length > 0) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function getChallengeKey(): Buffer {
  const value = process.env.AUTH_CHALLENGE_KEY;
  if (value !== undefined && value.trim().length > 0) return Buffer.from(value.trim(), "base64");
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_CHALLENGE_KEY is required in production");
  return createHmac("sha256", "bordchamp-dev-challenge-key").update("static").digest();
}
