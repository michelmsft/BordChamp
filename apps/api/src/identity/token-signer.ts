import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionVersion: number;
}

export interface VerifiedAccessToken {
  readonly userId: string;
  readonly sessionVersion: number;
}

export const TOKEN_SIGNER = Symbol("TOKEN_SIGNER");

export interface TokenSigner {
  readonly accessTokenTtlSeconds: number;
  issueAccessToken(claims: AccessTokenClaims): Promise<string>;
  verifyAccessToken(token: string): Promise<VerifiedAccessToken>;
}

const issuer = "bordchamp";
const audience = "bordchamp-api";

class LocalJwtSigner implements TokenSigner {
  readonly accessTokenTtlSeconds = 15 * 60;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor() {
    const explicitPrivate = process.env.AUTH_JWT_PRIVATE_KEY?.trim();
    const explicitPublic = process.env.AUTH_JWT_PUBLIC_KEY?.trim();
    if (explicitPrivate && explicitPublic) {
      this.privateKey = createPrivateKey({ key: explicitPrivate, format: "pem" });
      this.publicKey = createPublicKey({ key: explicitPublic, format: "pem" });
      return;
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_JWT_PRIVATE_KEY and AUTH_JWT_PUBLIC_KEY are required in production");
    }
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sv: claims.sessionVersion, typ: "access" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTokenTtlSeconds}s`)
      .sign(this.privateKey);
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      algorithms: ["RS256"],
      issuer,
      audience,
    });
    if (payload.typ !== "access") throw new Error("Access token type is invalid");
    if (typeof payload.sub !== "string" || payload.sub.length === 0) throw new Error("Access token subject is missing");
    if (typeof payload.sv !== "number") throw new Error("Access token session version is missing");
    return { userId: payload.sub, sessionVersion: payload.sv };
  }
}

export function createTokenSigner(): TokenSigner {
  return new LocalJwtSigner();
}
