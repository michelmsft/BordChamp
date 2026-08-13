import type { ActorContext, EntityStatus } from "@bordchamp/domain";

import {
  permissionCatalog,
  type PermissionAction,
  type PermissionDefinition,
  type PermissionScope,
} from "./catalog.js";

export type AuthorizationReason =
  | "allowed"
  | "authenticationRequired"
  | "personaNotAllowed"
  | "scopeNotAllowed"
  | "entityStatusNotAllowed";

export interface AuthorizationRequest {
  readonly action: PermissionAction;
  readonly actor?: ActorContext;
  readonly entityStatus: EntityStatus;
  readonly resourceOrganizationId?: string;
  readonly assignmentId?: string;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: AuthorizationReason;
}

function actorHasScope(
  actor: ActorContext,
  scopes: readonly PermissionScope[],
  request: AuthorizationRequest,
): boolean {
  if (scopes.includes("authenticated")) {
    return true;
  }

  if (
    scopes.includes("all") &&
    actor.personas.some(
      (persona) => persona === "ExchangeAdmin" || persona === "Regulator",
    )
  ) {
    return true;
  }

  if (
    scopes.includes("ownOrganization") &&
    actor.organizationId !== undefined &&
    actor.organizationId === request.resourceOrganizationId
  ) {
    return true;
  }

  if (
    scopes.includes("representedOrganization") &&
    request.resourceOrganizationId !== undefined &&
    actor.representedOrganizationIds.includes(request.resourceOrganizationId)
  ) {
    return true;
  }

  return (
    scopes.includes("assigned") &&
    request.assignmentId !== undefined &&
    actor.assignmentIds.includes(request.assignmentId)
  );
}

export function authorize(
  request: AuthorizationRequest,
): AuthorizationDecision {
  const permission: PermissionDefinition = permissionCatalog[request.action];

  if (permission.public) {
    return { allowed: true, reason: "allowed" };
  }

  if (request.actor === undefined) {
    return { allowed: false, reason: "authenticationRequired" };
  }

  if (
    permission.personas.length > 0 &&
    !request.actor.personas.some((persona) =>
      permission.personas.includes(persona),
    )
  ) {
    return { allowed: false, reason: "personaNotAllowed" };
  }

  if (!permission.allowedEntityStatuses.includes(request.entityStatus)) {
    return { allowed: false, reason: "entityStatusNotAllowed" };
  }

  if (!actorHasScope(request.actor, permission.scopes, request)) {
    return { allowed: false, reason: "scopeNotAllowed" };
  }

  return { allowed: true, reason: "allowed" };
}