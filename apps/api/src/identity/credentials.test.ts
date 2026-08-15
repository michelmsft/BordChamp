import { TOTP, URI } from "otpauth";
import { describe, expect, it } from "vitest";

import { generateEnrollment, verifyTotp } from "./credentials.js";

describe("authenticator credentials", () => {
  it("regenerates a valid enrollment from a persisted Base32 secret", () => {
    const original = generateEnrollment("admin@bordchamps.com");
    const restored = generateEnrollment("admin@bordchamps.com", original.secretBase32);
    const authenticator = URI.parse(restored.otpauthUri);

    expect(authenticator).toBeInstanceOf(TOTP);
    expect(restored.secretBase32).toBe(original.secretBase32);
    expect(verifyTotp(restored.secretBase32, authenticator.generate())).toBe(true);
  });
});