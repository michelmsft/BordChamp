import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import argon2 from "argon2";
import { TOTP } from "otpauth";

const TOTP_LABEL = "BordChamp";
const TOTP_ISSUER = "BordChamp";
const TOTP_ALGORITHM = "SHA1" as const;
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;

export interface EnrollmentSecret {
  readonly secretBase32: string;
  readonly otpauthUri: string;
}

export interface EncryptedSecret {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly tag: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateEnrollment(email: string): EnrollmentSecret {
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: `${TOTP_LABEL}:${normalizeEmail(email)}`,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
  });
  return { secretBase32: totp.secret.base32, otpauthUri: totp.toString() };
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/u.test(clean)) return false;
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: TOTP_LABEL,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: secretBase32,
  });
  const delta = totp.validate({ token: clean, window: TOTP_WINDOW });
  return delta !== null;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getEncryptionKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), tag: tag.toString("base64") };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

export interface RecoveryCode {
  readonly id: string;
  readonly plaintext: string;
  readonly hash: string;
}

export function generateRecoveryCodes(count = 10): readonly RecoveryCode[] {
  return Array.from({ length: count }, () => {
    const plaintext = formatRecoveryPlaintext(randomBytes(5));
    return { id: randomUUID(), plaintext, hash: hashRecovery(plaintext) };
  });
}

export function hashRecovery(plaintext: string): string {
  return createHash("sha256").update(plaintext.replace(/[^A-Z0-9]/gu, "").toUpperCase()).digest("hex");
}

export interface RefreshTokenMaterial {
  readonly userId: string;
  readonly tokenId: string;
  readonly familyId: string;
  readonly plaintext: string;
  readonly hash: string;
}

export function issueRefreshToken(userId: string, familyId?: string): RefreshTokenMaterial {
  const tokenId = randomUUID();
  const family = familyId ?? randomUUID();
  const secret = randomBytes(48).toString("base64url");
  const plaintext = `${userId}.${tokenId}.${secret}`;
  return { userId, tokenId, familyId: family, plaintext, hash: hashRefreshSecret(secret) };
}

export function parseRefreshToken(value: string): { readonly userId: string; readonly tokenId: string; readonly secret: string } | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, tokenId, secret] = parts;
  if (!userId || !tokenId || !secret) return null;
  return { userId, tokenId, secret };
}

export function hashRefreshSecret(secret: string): string {
  return createHmac("sha256", getRefreshPepper()).update(secret).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function formatRecoveryPlaintext(entropy: Buffer): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (const byte of entropy) result += alphabet[byte % alphabet.length];
  return `${result.slice(0, 5)}-${result.slice(5)}`;
}

function getEncryptionKey(): Buffer {
  const value = process.env.AUTH_SECRET_ENCRYPTION_KEY;
  if (value === undefined || value.trim().length === 0) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET_ENCRYPTION_KEY is required in production");
    return createHash("sha256").update("bordchamp-dev-encryption-key").digest();
  }
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) throw new Error("AUTH_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

function getRefreshPepper(): Buffer {
  const value = process.env.AUTH_REFRESH_TOKEN_PEPPER;
  if (value === undefined || value.trim().length === 0) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_REFRESH_TOKEN_PEPPER is required in production");
    return createHash("sha256").update("bordchamp-dev-refresh-pepper").digest();
  }
  return Buffer.from(value.trim(), "base64");
}
