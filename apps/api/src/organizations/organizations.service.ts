import { authorize, type PermissionAction } from "@bordchamp/authz";
import type { ActorContext } from "@bordchamp/domain";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  ORGANIZATION_REPOSITORY,
  OrganizationConflictError,
  OrganizationNotFoundError,
  type CreateOrganizationInput,
  type Organization,
  type OrganizationRepository,
} from "./organization.repository.js";

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
  ) {}

  async create(actor: ActorContext, input: Omit<CreateOrganizationInput, "ownerUserId">): Promise<Organization> {
    this.assertAllowed("organization.create", actor, "active");
    return this.organizations.create({ ...input, ownerUserId: actor.userId });
  }

  async get(actor: ActorContext, id: string): Promise<Organization> {
    const organization = await this.requireOrganization(id);
    this.assertAllowed("organization.view", actor, organization.status, id);
    return organization;
  }

  async updateName(actor: ActorContext, id: string, name: string, etag: string): Promise<Organization> {
    const organization = await this.requireOrganization(id);
    this.assertAllowed("organization.update", actor, organization.status, id);
    return this.mapConflict(() => this.organizations.updateName(id, name, etag, actor.userId));
  }

  async deactivate(actor: ActorContext, id: string, reason: string, etag: string): Promise<Organization> {
    const organization = await this.requireOrganization(id);
    this.assertAllowed("entity.deactivate", actor, organization.status, id);
    return this.mapConflict(() => this.organizations.deactivate(id, reason, etag, actor.userId));
  }

  async createMandate(
    actor: ActorContext,
    organizationId: string,
    granteeUserId: string,
    validUntil?: string,
  ): Promise<{ readonly id: string }> {
    const organization = await this.requireOrganization(organizationId);
    this.assertAllowed("organization.mandate.manage", actor, organization.status, organizationId);
    return this.organizations.createMandate({
      organizationId,
      granteeUserId,
      actorUserId: actor.userId,
      ...(validUntil === undefined ? {} : { validUntil }),
    });
  }

  private async requireOrganization(id: string): Promise<Organization> {
    const organization = await this.organizations.get(id);
    if (organization === undefined) {
      throw new NotFoundException("Organization not found");
    }
    return organization;
  }

  private assertAllowed(
    action: PermissionAction,
    actor: ActorContext,
    status: Organization["status"],
    resourceOrganizationId?: string,
  ): void {
    const decision = authorize({
      action,
      actor,
      entityStatus: status,
      ...(resourceOrganizationId === undefined ? {} : { resourceOrganizationId }),
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }
  }

  private async mapConflict(operation: () => Promise<Organization>): Promise<Organization> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof OrganizationConflictError) {
        throw new ConflictException("The organization changed; refresh and retry");
      }
      if (error instanceof OrganizationNotFoundError) {
        throw new NotFoundException("Organization not found");
      }
      throw error;
    }
  }
}