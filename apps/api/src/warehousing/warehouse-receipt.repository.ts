import {
  TableClient,
  TableTransaction,
  type TableEntity,
} from "@azure/data-tables";
import { randomUUID } from "node:crypto";

import type { LotQuantity } from "../inventory/inventory.repository.js";
import {
  createTableClient,
  hasTableStorageConfiguration,
} from "../storage/table-client.js";

export const WAREHOUSE_RECEIPT_REPOSITORY = Symbol(
  "WAREHOUSE_RECEIPT_REPOSITORY",
);

export interface WarehouseReceipt {
  readonly id: string;
  readonly warehouseOrganizationId: string;
  readonly lotId: string;
  readonly ownerOrganizationId: string;
  readonly quantity: LotQuantity;
  readonly status: "active" | "released";
  readonly pledgeStatus: "none" | "pledged";
  readonly pledgeeOrganizationId?: string;
  readonly pledgeReference?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly releasedAt?: string;
  readonly etag: string;
}

export interface IssueReceiptInput {
  readonly warehouseOrganizationId: string;
  readonly lotId: string;
  readonly ownerOrganizationId: string;
  readonly quantity: LotQuantity;
  readonly actorUserId: string;
}

export class WarehouseReceiptConflictError extends Error {}

export interface WarehouseReceiptRepository {
  issue(input: IssueReceiptInput): Promise<WarehouseReceipt>;
  get(id: string): Promise<WarehouseReceipt | undefined>;
  pledge(
    id: string,
    pledgeeOrganizationId: string,
    pledgeReference: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt>;
  releasePledge(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt>;
  transfer(
    id: string,
    newOwnerOrganizationId: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt>;
  release(
    id: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt>;
}

interface ReceiptEntity extends TableEntity {
  readonly warehouseOrganizationId: string;
  readonly lotId: string;
  readonly ownerOrganizationId: string;
  readonly quantityValue: number;
  readonly quantityScale: number;
  readonly unitCode: string;
  readonly status: "active" | "released";
  readonly pledgeStatus: "none" | "pledged";
  readonly pledgeeOrganizationId?: string;
  readonly pledgeReference?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly releasedAt?: string;
}

function toReceipt(
  entity: ReceiptEntity & { readonly etag?: string },
): WarehouseReceipt {
  return {
    id: entity.partitionKey,
    warehouseOrganizationId: entity.warehouseOrganizationId,
    lotId: entity.lotId,
    ownerOrganizationId: entity.ownerOrganizationId,
    quantity: {
      value: entity.quantityValue,
      scale: entity.quantityScale,
      unitCode: entity.unitCode,
    },
    status: entity.status,
    pledgeStatus: entity.pledgeStatus,
    ...(entity.pledgeeOrganizationId === undefined
      ? {}
      : { pledgeeOrganizationId: entity.pledgeeOrganizationId }),
    ...(entity.pledgeReference === undefined
      ? {}
      : { pledgeReference: entity.pledgeReference }),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    ...(entity.releasedAt === undefined
      ? {}
      : { releasedAt: entity.releasedAt }),
    etag: entity.etag ?? "",
  };
}

function profile(receipt: WarehouseReceipt): ReceiptEntity {
  return {
    partitionKey: receipt.id,
    rowKey: "PROFILE",
    warehouseOrganizationId: receipt.warehouseOrganizationId,
    lotId: receipt.lotId,
    ownerOrganizationId: receipt.ownerOrganizationId,
    quantityValue: receipt.quantity.value,
    quantityScale: receipt.quantity.scale,
    unitCode: receipt.quantity.unitCode,
    status: receipt.status,
    pledgeStatus: receipt.pledgeStatus,
    ...(receipt.pledgeeOrganizationId === undefined
      ? {}
      : { pledgeeOrganizationId: receipt.pledgeeOrganizationId }),
    ...(receipt.pledgeReference === undefined
      ? {}
      : { pledgeReference: receipt.pledgeReference }),
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
    ...(receipt.releasedAt === undefined
      ? {}
      : { releasedAt: receipt.releasedAt }),
  };
}

function event(
  receiptId: string,
  eventType: string,
  actorUserId: string,
  occurredAt: string,
  details: string,
): TableEntity {
  return {
    partitionKey: receiptId,
    rowKey: `EVENT:${occurredAt}:${randomUUID()}`,
    eventType,
    actorUserId,
    occurredAt,
    details,
  };
}

abstract class BaseWarehouseReceiptRepository
  implements WarehouseReceiptRepository
{
  abstract issue(input: IssueReceiptInput): Promise<WarehouseReceipt>;
  abstract get(id: string): Promise<WarehouseReceipt | undefined>;
  abstract change(
    id: string,
    etag: string,
    actorUserId: string,
    eventType: string,
    details: string,
    apply: (receipt: WarehouseReceipt, now: string) => WarehouseReceipt,
  ): Promise<WarehouseReceipt>;

  pledge(
    id: string,
    pledgeeOrganizationId: string,
    pledgeReference: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt> {
    return this.change(
      id,
      etag,
      actorUserId,
      "receipt.pledged",
      pledgeReference,
      (receipt) => ({
        ...receipt,
        pledgeStatus: "pledged",
        pledgeeOrganizationId,
        pledgeReference,
      }),
    );
  }

  releasePledge(
    id: string,
    reason: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt> {
    return this.change(
      id,
      etag,
      actorUserId,
      "receipt.pledgeReleased",
      reason,
      (receipt) => {
        const { pledgeeOrganizationId: _pledgee, pledgeReference: _reference, ...rest } = receipt;
        return { ...rest, pledgeStatus: "none" };
      },
    );
  }

  transfer(
    id: string,
    newOwnerOrganizationId: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt> {
    return this.change(
      id,
      etag,
      actorUserId,
      "receipt.transferred",
      newOwnerOrganizationId,
      (receipt) => ({ ...receipt, ownerOrganizationId: newOwnerOrganizationId }),
    );
  }

  release(
    id: string,
    etag: string,
    actorUserId: string,
  ): Promise<WarehouseReceipt> {
    return this.change(
      id,
      etag,
      actorUserId,
      "receipt.released",
      "released",
      (receipt, now) => ({ ...receipt, status: "released", releasedAt: now }),
    );
  }
}

export class InMemoryWarehouseReceiptRepository extends BaseWarehouseReceiptRepository {
  private readonly receipts = new Map<string, WarehouseReceipt>();
  private version = 0;

  async issue(input: IssueReceiptInput): Promise<WarehouseReceipt> {
    const now = new Date().toISOString();
    const receipt: WarehouseReceipt = {
      id: `WR-${input.lotId}`,
      warehouseOrganizationId: input.warehouseOrganizationId,
      lotId: input.lotId,
      ownerOrganizationId: input.ownerOrganizationId,
      quantity: input.quantity,
      status: "active",
      pledgeStatus: "none",
      createdAt: now,
      updatedAt: now,
      etag: this.nextEtag(),
    };
    if (this.receipts.has(receipt.id)) {
      throw new WarehouseReceiptConflictError(receipt.id);
    }
    this.receipts.set(receipt.id, receipt);
    return receipt;
  }

  async get(id: string): Promise<WarehouseReceipt | undefined> {
    return this.receipts.get(id);
  }

  async change(
    id: string,
    etag: string,
    _actorUserId: string,
    _eventType: string,
    _details: string,
    apply: (receipt: WarehouseReceipt, now: string) => WarehouseReceipt,
  ): Promise<WarehouseReceipt> {
    const current = this.receipts.get(id);
    if (current === undefined) {
      throw new Error("Warehouse receipt not found");
    }
    if (current.etag !== etag) {
      throw new WarehouseReceiptConflictError(id);
    }
    const now = new Date().toISOString();
    const updated = { ...apply(current, now), updatedAt: now, etag: this.nextEtag() };
    this.receipts.set(id, updated);
    return updated;
  }

  private nextEtag(): string {
    this.version += 1;
    return `W/\"${this.version}\"`;
  }
}

export class AzureTableWarehouseReceiptRepository extends BaseWarehouseReceiptRepository {
  constructor(private readonly receipts: TableClient) {
    super();
  }

  async issue(input: IssueReceiptInput): Promise<WarehouseReceipt> {
    const now = new Date().toISOString();
    const receipt: WarehouseReceipt = {
      id: `WR-${input.lotId}`,
      warehouseOrganizationId: input.warehouseOrganizationId,
      lotId: input.lotId,
      ownerOrganizationId: input.ownerOrganizationId,
      quantity: input.quantity,
      status: "active",
      pledgeStatus: "none",
      createdAt: now,
      updatedAt: now,
      etag: "",
    };
    const transaction = new TableTransaction();
    transaction.createEntity(profile(receipt));
    transaction.createEntity(
      event(receipt.id, "receipt.issued", input.actorUserId, now, input.lotId),
    );
    try {
      await this.receipts.submitTransaction(transaction.actions);
    } catch (error: unknown) {
      if (isStatusCode(error, 409)) {
        throw new WarehouseReceiptConflictError(receipt.id);
      }
      throw error;
    }
    return this.requireReceipt(receipt.id);
  }

  async get(id: string): Promise<WarehouseReceipt | undefined> {
    try {
      return toReceipt(await this.receipts.getEntity<ReceiptEntity>(id, "PROFILE"));
    } catch (error: unknown) {
      if (isStatusCode(error, 404)) {
        return undefined;
      }
      throw error;
    }
  }

  async change(
    id: string,
    etag: string,
    actorUserId: string,
    eventType: string,
    details: string,
    apply: (receipt: WarehouseReceipt, now: string) => WarehouseReceipt,
  ): Promise<WarehouseReceipt> {
    const current = await this.requireReceipt(id);
    const now = new Date().toISOString();
    const updated = { ...apply(current, now), updatedAt: now };
    const transaction = new TableTransaction();
    transaction.updateEntity(profile(updated), "Replace", { etag });
    transaction.createEntity(event(id, eventType, actorUserId, now, details));
    try {
      await this.receipts.submitTransaction(transaction.actions);
    } catch (error: unknown) {
      if (isStatusCode(error, 409) || isStatusCode(error, 412)) {
        throw new WarehouseReceiptConflictError(id);
      }
      throw error;
    }
    return this.requireReceipt(id);
  }

  private async requireReceipt(id: string): Promise<WarehouseReceipt> {
    const receipt = await this.get(id);
    if (receipt === undefined) {
      throw new Error("Warehouse receipt not found");
    }
    return receipt;
  }
}

function isStatusCode(error: unknown, statusCode: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === statusCode
  );
}

export function createWarehouseReceiptRepository(): WarehouseReceiptRepository {
  if (!hasTableStorageConfiguration()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Azure Table Storage configuration is required in production");
    }
    return new InMemoryWarehouseReceiptRepository();
  }
  return new AzureTableWarehouseReceiptRepository(
    createTableClient(
      process.env.AZURE_STORAGE_WAREHOUSE_RECEIPTS_TABLE ?? "WarehouseReceipts",
    ),
  );
}