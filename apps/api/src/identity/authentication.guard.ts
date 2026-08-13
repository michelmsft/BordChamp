import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { PUBLIC_ROUTE } from "./public-route.js";
import { TOKEN_SIGNER, type TokenSigner } from "./token-signer.js";
import { RequestActorService } from "./request-actor.service.js";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "./identity.repository.js";

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RequestActorService) private readonly actor: RequestActorService,
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSigner,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (await this.actor.authenticateTestRequest(request)) return true;
    const header = request.headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) throw new UnauthorizedException("Access token is missing");
    const token = header.slice(7).trim();
    let verified: { userId: string; sessionVersion: number };
    try {
      verified = await this.signer.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException("Access token is invalid");
    }
    const profile = await this.identities.getProfile(verified.userId);
    if (!profile || profile.status !== "active") throw new UnauthorizedException("Account is not active");
    if (profile.sessionVersion !== verified.sessionVersion) throw new UnauthorizedException("Session has been revoked");
    this.actor.authenticate(request, { userId: profile.id, sessionVersion: profile.sessionVersion });
    return true;
  }
}
