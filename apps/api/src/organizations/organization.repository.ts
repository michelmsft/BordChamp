import {
  TableClient,
  TableTransaction,
  type TableEntity,
} from "@azure/data-tables";
import { randomUUID } from "node:crypto";

import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";

export const ORGANIZATION_REPOSITORY = Symbol("ORGANIZATION_REPOSITORY");

export type OrganizationType =
  | "farmer"
  | "cooperative"
  | "trader"
  | "broker"
  | "buyer"
  | "warehouse"
  | "inspector"
  | "logisticsProvider";

export type OrganizationStatus = "active" | "windDown" | "suspended" | "inactive";

export interface Organization {
  readonly id: string;
  readonly type: OrganizationType;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly etag: string;
}

export interface CreateOrganizationInput {
  readonly type: OrganizationType;
  readonly name: string;
  readonly ownerUserId: string;
}

export interface CreateMandateInput {
  readonly organizationId: string;
  readonly granteeUserId: string;
  readonly validUntil?: string;
  readonly actorUserId: string;
}

export class OrganizationNotFoundError extends Error {}
export class OrganizationConflictError extends Error {}

export interface OrganizationRepository {
  create(input: CreateOrganizationInput): Promise<Organization>;
  get(id: string): Promise<Organization | undefined>;
  updateName(id: string, name: string, etag: string, actorUserId: string): Promise<Organization>;
  deactivate(id: string, reason: string, etag: string, actorUserId: string): Promise<Organization>;
  createMandate(input: CreateMandateInput): Promise<{ readonly id: string }>;
  resolveRepresentedOrganizations(userId: string): Promise<readonly string[]>;
}

interface OrganizationEntity extends TableEntity {
  readonly type: OrganizationType;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface MandateDirectoryEntity extends TableEntity {
  readonly organizationId: string;
  readonly status: "active" | "revoked";
  readonly validFrom: string;
  readonly validUntil?: string;
}

function toOrganization(entity: OrganizationEntity & { readonly etag?: string }): Organization {
  return {
    id: entity.partitionKey,
    type: entity.type,
    name: entity.name,
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    etag: entity.etag ?? "",
  };
}

function auditEntity(
  organizationId: string,
  action: string,
  actorUserId: string,
  occurredAt: string,
  details: string,
): TableEntity {
  return {
    partitionKey: organizationId,
    rowKey: `AUDIT:${occurredAt}:${randomUUID()}`,
    action,
    actorUserId,
    occurredAt,
    details,
  };
}

export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly organizations = new Map<string, Organization>();
  private readonly represented = new Map<string, Set<string>>();
  private version = 0;

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const now = new Date().toISOString();
    const organization: Organization = {
      id: randomUUID(),
      type: input.type,
      name: input.name,
      status: "active",
      createdAt: now,
      updatedAt: now,
      etag: this.nextEtag(),
    };
    this.organizations.set(organization.id, organization);
    return organization;
  }

  async get(id: string): Promise<Organization | undefined> {
    return this.organizations.get(id);
  }

  async updateName(id: string, name: string, etag: string): Promise<Organization> {
    const current = this.requireCurrent(id, etag);
    const updated = {
      ...current,
      name,
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.organizations.set(id, updated);
    return updated;
  }

  async deactivate(id: string, _reason: string, etag: string): Promise<Organization> {
    const current = this.requireCurrent(id, etag);
    const updated = {
      ...current,
      status: "inactive" as const,
      updatedAt: new Date().toISOString(),
      etag: this.nextEtag(),
    };
    this.organizations.set(id, updated);
    return updated;
  }

  async createMandate(input: CreateMandateInput): Promise<{ readonly id: string }> {
    const id = randomUUID();
    const organizations = this.represented.get(input.granteeUserId) ?? new Set<string>();
    organizations.add(input.organizationId);
    this.represented.set(input.granteeUserId, organizations);
    return { id };
  }

  async resolveRepresentedOrganizations(userId: string): Promise<readonly string[]> {
    return [...(this.represented.get(userId) ?? [])];
  }

  private requireCurrent(id: string, etag: string): Organization {
    const current = this.organizations.get(id);
    if (current === undefined) {
      throw new OrganizationNotFoundError(id);
    }
    if (current.etag !== etag) {
      throw new OrganizationConflictError(id);
    }
    return current;
  }

  private nextEtag(): string {
    this.version += 1;
    return `W/\"${this.version}\"`;
  }
}

export class AzureTableOrganizationRepository implements OrganizationRepository {
  constructor(
    private readonly organizations: TableClient,
    private readonly userDirectory: TableClient,
  ) {}

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const profile: OrganizationEntity = {
      partitionKey: id,
      rowKey: "PROFILE",
      type: input.type,
      name: input.name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const transaction = new TableTransaction();
    transaction.createEntity(profile);
    transaction.createEntity({
      partitionKey: id,
      rowKey: `MEMBER:${input.ownerUserId}`,
      userId: input.ownerUserId,
      role: "owner",
      status: "active",
      createdAt: now,
    });
    transaction.createEntity(
      auditEntity(id, "organization.created", input.ownerUserId, now, input.name),
    );
    await this.organizations.submitTransaction(transaction.actions);
    const created = await this.get(id);
    if (created === undefined) {
      throw new OrganizationNotFoundError(id);
    }
    return created;
  }

  async get(id: string): Promise<Organization | undefined> {
    try {
      const entity = await this.organizations.getEntity<OrganizationEntity>(id, "PROFILE");
      return toOrganization(entity);
    } catch (error: unknown) {
      if (isStatusCode(error, 404)) {
        return undefined;
      }
      throw error;
    }
  }

  async updateName(id: string, name: string, etag: string, actorUserId: string): Promise<Organization> {
    const current = await this.requireOrganization(id);
    const now = new Date().toISOString();
    const transaction = new TableTransaction();
    transaction.updateEntity(
      { ...current, partitionKey: id, rowKey: "PROFILE", name, updatedAt: now },
      "Replace",
      { etag },
    );
    transaction.createEntity(auditEntity(id, "organization.updated", actorUserId, now, name));
    await this.submitWithConflict(transaction);
    return this.requireOrganization(id);
  }

  async deactivate(id: string, reason: string, etag: string, actorUserId: string): Promise<Organization> {
    const current = await this.requireOrganization(id);
    const now = new Date().toISOString();
    const transaction = new TableTransaction();
    transaction.updateEntity(
      { ...current, partitionKey: id, rowKey: "PROFILE", status: "inactive", updatedAt: now },
      "Replace",
      { etag },
    );
    transaction.createEntity(auditEntity(id, "organization.deactivated", actorUserId, now, reason));
    await this.submitWithConflict(transaction);
    return this.requireOrganization(id);
  }

  async createMandate(input: CreateMandateInput): Promise<{ readonly id: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const mandate = {
      partitionKey: input.organizationId,
      rowKey: `MANDATE:${id}`,
      mandateId: id,
      granteeUserId: input.granteeUserId,
      status: "active",
      validFrom: now,
      ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
    };
    const transaction = new TableTransaction();
    transaction.createEntity(mandate);
    transaction.createEntity(
      auditEntity(input.organizationId, "mandate.created", input.actorUserId, now, id),
    );
    await this.organizations.submitTransaction(transaction.actions);
    await this.userDirectory.upsertEntity(
      {
        partitionKey: input.granteeUserId,
        rowKey: `MANDATE:${id}`,
        organizationId: input.organizationId,
        status: "active",
        validFrom: now,
        ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
      },
      "Replace",
    );
    return { id };
  }

  async resolveRepresentedOrganizations(userId: string): Promise<readonly string[]> {
    const now = new Date().toISOString();
    const result: string[] = [];
    const entities = this.userDirectory.listEntities<MandateDirectoryEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${userId}' and status eq 'active'`,
        select: ["organizationId", "validFrom", "validUntil"],
      },
    });
    for await (const entity of entities) {
      if (entity.validFrom <= now && (entity.validUntil === undefined || entity.validUntil > now)) {
        result.push(entity.organizationId);
      }
    }
    return result;
  }

  private async requireOrganization(id: string): Promise<Organization> {
    const organization = await this.get(id);
    if (organization === undefined) {
      throw new OrganizationNotFoundError(id);
    }
    return organization;
  }

  private async submitWithConflict(transaction: TableTransaction): Promise<void> {
    try {
      await this.organizations.submitTransaction(transaction.actions);
    } catch (error: unknown) {
      if (isStatusCode(error, 409) || isStatusCode(error, 412)) {
        throw new OrganizationConflictError("The organization was changed by another request");
      }
      throw error;
    }
  }
}

function isStatusCode(error: unknown, statusCode: number): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === statusCode;
}

export function createOrganizationRepository(): OrganizationRepository {
  if (!hasTableStorageConfiguration()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Azure Table Storage configuration is required in production");
    }
    return new InMemoryOrganizationRepository();
  }

  return new AzureTableOrganizationRepository(
    createTableClient(
      process.env.AZURE_STORAGE_ORGANIZATIONS_TABLE ?? "Organizations",
    ),
    createTableClient(
      process.env.AZURE_STORAGE_USER_DIRECTORY_TABLE ?? "UserDirectory",
    ),
  );
}