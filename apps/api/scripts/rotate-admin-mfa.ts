// One-off script: rotate the TOTP credential of an existing admin user in the
// UserDirectory table and write the enrollment details to a file.
// Usage: from apps/api, `AZURE_STORAGE_CONNECTION_STRING=... tsx scripts/rotate-admin-mfa.ts`
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { TableClient } from "@azure/data-tables";

import {
  encryptSecret,
  generateEnrollment,
  generateRecoveryCodes,
  hashEmail,
  normalizeEmail,
} from "../src/identity/credentials.js";
import { hasTableStorageConfiguration } from "../src/storage/table-client.js";

const email = normalizeEmail(process.env.BORDCHAMP_ADMIN_EMAIL ?? "admin@bordchamps.com");

if (!hasTableStorageConfiguration()) {
  console.error("Azure Table Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING.");
  process.exit(1);
}

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connectionString || connectionString.length === 0) {
  console.error("AZURE_STORAGE_CONNECTION_STRING is required.");
  process.exit(1);
}

const tableName = process.env.AZURE_STORAGE_USER_DIRECTORY_TABLE ?? "UserDirectory";
const users = TableClient.fromConnectionString(connectionString, tableName);

const emailHash = hashEmail(email);
let userId: string;
try {
  const lookup = await users.getEntity<{ userId: string }>("LOGIN", `EMAIL:${emailHash}`);
  userId = lookup.userId;
} catch (error) {
  const status = (error as { statusCode?: number }).statusCode;
  console.error(`No admin with email ${email} found (status=${status ?? "?"}).`);
  process.exit(1);
}

const enrollment = generateEnrollment(email);
const encrypted = encryptSecret(enrollment.secretBase32);
await users.updateEntity(
  {
    partitionKey: userId,
    rowKey: "CREDENTIAL",
    totpCiphertext: encrypted.ciphertext,
    totpNonce: encrypted.nonce,
    totpTag: encrypted.tag,
    mfaEnrolled: true,
  },
  "Merge",
);

const codes = generateRecoveryCodes();
const banner = [
  "",
  "===================== BordChamp admin MFA rotated =====================",
  `  Email:         ${email}`,
  `  User ID:       ${userId}`,
  "  ----- MFA enrollment (scan in your authenticator app) -----",
  `  otpauth URI:   ${enrollment.otpauthUri}`,
  `  Base32 secret: ${enrollment.secretBase32}`,
  "  ----- Recovery codes (NOT yet stored - saveRecoveryCodes skipped) -----",
  ...codes.map(c => `    - ${c.plaintext}`),
  "========================================================================",
  "",
].join("\n");
console.log(banner);

const outPath = process.env.BORDCHAMP_ADMIN_SEED_FILE
  ?? resolve(process.cwd(), "..", "..", ".bordchamp", "admin-bootstrap.txt");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, banner, { encoding: "utf8" });
console.log(`Written to ${outPath}`);
