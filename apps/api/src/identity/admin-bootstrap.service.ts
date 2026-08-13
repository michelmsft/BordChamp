import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  encryptSecret,
  generateEnrollment,
  generateRecoveryCodes,
  hashPassword,
  normalizeEmail,
} from "./credentials.js";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
  type RecoveryCodeRecord,
} from "./identity.repository.js";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
  type OrganizationType,
} from "../organizations/organization.repository.js";

const DEFAULT_EMAIL = "admin@bordchamps.com";
const DEFAULT_PASSWORD = "Qwerty$1";
const DEFAULT_DISPLAY_NAME = "Admin System";
const DEFAULT_GIVEN = "Admin";
const DEFAULT_SURNAME = "System";
const DEFAULT_LOCALE = "fr-CI";
const DEFAULT_ORG_NAME = "BordChamp Exchange";
const DEFAULT_ORG_TYPE: OrganizationType = "trader";

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger("AdminBootstrap");

  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === "test") return;
    if (process.env.BORDCHAMP_SKIP_ADMIN_SEED === "1") return;
    const email = normalizeEmail(process.env.BORDCHAMP_ADMIN_EMAIL ?? DEFAULT_EMAIL);
    const password = process.env.BORDCHAMP_ADMIN_PASSWORD ?? DEFAULT_PASSWORD;
    const displayName = process.env.BORDCHAMP_ADMIN_DISPLAY_NAME ?? DEFAULT_DISPLAY_NAME;
    const orgName = process.env.BORDCHAMP_ADMIN_ORG_NAME ?? DEFAULT_ORG_NAME;

    try {
      const existing = await this.identities.findByEmail(email);
      if (existing) {
        this.logger.log(`Admin ${email} already exists (id=${existing.id}); skipping seed.`);
        return;
      }

      const enrollment = generateEnrollment(email);
      const passwordHash = await hashPassword(password);
      const totpSecret = encryptSecret(enrollment.secretBase32);
      const profile = await this.identities.createAccount({ email, passwordHash, totpSecret });
      await this.identities.markMfaEnrolled(profile.id);

      const afterMfa = await this.identities.getProfile(profile.id);
      if (!afterMfa) throw new Error("Profile disappeared after MFA enrollment");
      const withNames = await this.identities.updateProfile(
        profile.id,
        {
          displayName,
          givenName: DEFAULT_GIVEN,
          surname: DEFAULT_SURNAME,
          locale: DEFAULT_LOCALE,
          onboardingState: "organizationRequired",
        },
        afterMfa.etag,
      );

      const org = await this.organizations.create({
        type: DEFAULT_ORG_TYPE,
        name: orgName,
        ownerUserId: profile.id,
      });
      await this.identities.addMembership({
        userId: profile.id,
        organizationId: org.id,
        role: "owner",
        personas: ["ExchangeAdmin"],
        status: "active",
        joinedAt: new Date().toISOString(),
      });
      await this.identities.setPreferredOrganization(profile.id, org.id, withNames.etag);

      const codes = generateRecoveryCodes();
      const records: RecoveryCodeRecord[] = codes.map(entry => ({
        userId: profile.id,
        codeId: entry.id,
        codeHash: entry.hash,
      }));
      await this.identities.saveRecoveryCodes(profile.id, records);

      const banner = [
        "",
        "===================== BordChamp admin seeded =====================",
        `  Email:         ${email}`,
        `  Password:      ${password}`,
        `  Display name:  ${displayName}`,
        `  User ID:       ${profile.id}`,
        `  Organization:  ${orgName} (id=${org.id})`,
        `  Persona:       ExchangeAdmin`,
        "  ----- MFA enrollment (scan in your authenticator app) -----",
        `  otpauth URI:   ${enrollment.otpauthUri}`,
        `  Base32 secret: ${enrollment.secretBase32}`,
        "  ----- Recovery codes (store safely) -----",
        ...codes.map(c => `    - ${c.plaintext}`),
        "==================================================================",
        "",
      ].join("\n");
      this.logger.log(banner);

      const outPath = process.env.BORDCHAMP_ADMIN_SEED_FILE
        ?? resolve(process.cwd(), ".bordchamp", "admin-bootstrap.txt");
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, banner, { encoding: "utf8" });
        this.logger.log(`Admin bootstrap details written to ${outPath}`);
      } catch (fsError) {
        this.logger.warn(`Could not persist admin bootstrap file: ${(fsError as Error).message}`);
      }
    } catch (error) {
      this.logger.error(`Admin bootstrap failed: ${(error as Error).message}`);
    }
  }
}
