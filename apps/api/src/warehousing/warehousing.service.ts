import { authorize } from "@bordchamp/authz";
import type { ActorContext, EntityStatus } from "@bordchamp/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
  type LotQuantity,
} from "../inventory/inventory.repository.js";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organizations/organization.repository.js";
import {
  WAREHOUSE_RECEIPT_REPOSITORY,
  WarehouseReceiptConflictError,
  type WarehouseReceipt,
  type WarehouseReceiptRepository,
} from "./warehouse-receipt.repository.js";

@Injectable()
export class WarehousingService {
  constructor(
    @Inject(WAREHOUSE_RECEIPT_REPOSITORY)
    private readonly receipts: WarehouseReceiptRepository,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventory: InventoryRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
  ) {}

  async issue(
    actor: ActorContext,
    warehouseOrganizationId: string,
    lotId: string,
    quantity: LotQuantity,
  ): Promise<WarehouseReceipt> {
    const warehouse = await this.organizations.get(warehouseOrganizationId);
    if (warehouse === undefined || warehouse.type !== "warehouse") {
      throw new BadRequestException("Warehouse organization not found");
    }
    this.assert(
      "warehouse.receipt.issue",
      actor,
      warehouse.status,
      warehouseOrganizationId,
    );
    const lot = await this.inventory.get(lotId);
    if (lot === undefined || lot.status !== "available") {
      throw new BadRequestException("Only an available lot can enter storage");
    }
    if (!sameQuantity(lot.quantity, quantity)) {
      throw new BadRequestException("Receipt quantity must equal the lot quantity");
    }
    return this.mapConflict(() =>
      this.receipts.issue({
        warehouseOrganizationId,
        lotId,
        ownerOrganizationId: lot.ownerOrganizationId,
        quantity,
        actorUserId: actor.userId,
      }),
    );
  }

  async get(actor: ActorContext, id: string): Promise<WarehouseReceipt> {
    const receipt = await this.requireReceipt(id);
    const resourceOrganizationId =
      actor.personas.includes("WarehouseOperator")
        ? receipt.warehouseOrganizationId
        : receipt.ownerOrganizationId;
    this.assert(
      "warehouse.receipt.view",
      actor,
      receiptStatus(receipt.status),
      resourceOrganizationId,
      receipt.id,
    );
    return receipt;
  }

  async pledge(
    actor: ActorContext,
    id: string,
    pledgeeOrganizationId: string,
    pledgeReference: string,
    etag: string,
  ): Promise<WarehouseReceipt> {
    const receipt = await this.requireActiveReceipt(id);
    if (receipt.pledgeStatus === "pledged") {
      throw new BadRequestException("Receipt is already pledged");
    }
    await this.requireActiveOrganization(pledgeeOrganizationId);
    this.assertOwner("warehouse.receipt.pledge", actor, receipt);
    return this.mapConflict(() =>
      this.receipts.pledge(
        id,
        pledgeeOrganizationId,
        pledgeReference,
        etag,
        actor.userId,
      ),
    );
  }

  async releasePledge(
    actor: ActorContext,
    id: string,
    reason: string,
    etag: string,
  ): Promise<WarehouseReceipt> {
    const receipt = await this.requireActiveReceipt(id);
    if (receipt.pledgeStatus !== "pledged") {
      throw new BadRequestException("Receipt is not pledged");
    }
    if (receipt.pledgeeOrganizationId === undefined) {
      throw new BadRequestException("Receipt pledgee is missing");
    }
    this.assert(
      "warehouse.receipt.pledge.release",
      actor,
      "active",
      receipt.pledgeeOrganizationId,
    );
    return this.mapConflict(() =>
      this.receipts.releasePledge(id, reason, etag, actor.userId),
    );
  }

  async transfer(
    actor: ActorContext,
    id: string,
    newOwnerOrganizationId: string,
    etag: string,
  ): Promise<WarehouseReceipt> {
    const receipt = await this.requireActiveReceipt(id);
    if (receipt.pledgeStatus === "pledged") {
      throw new BadRequestException("A pledged receipt cannot be transferred");
    }
    await this.requireActiveOrganization(newOwnerOrganizationId);
    this.assertOwner("warehouse.receipt.transfer", actor, receipt);
    return this.mapConflict(() =>
      this.receipts.transfer(id, newOwnerOrganizationId, etag, actor.userId),
    );
  }

  async release(
    actor: ActorContext,
    id: string,
    etag: string,
  ): Promise<WarehouseReceipt> {
    const receipt = await this.requireActiveReceipt(id);
    this.assert(
      "warehouse.receipt.release",
      actor,
      "active",
      receipt.warehouseOrganizationId,
    );
    if (receipt.pledgeStatus === "pledged") {
      throw new BadRequestException("A pledged receipt cannot be released");
    }
    const lot = await this.inventory.get(receipt.lotId);
    if (lot === undefined || lot.status !== "available") {
      throw new BadRequestException("The linked lot is held or inactive");
    }
    return this.mapConflict(() => this.receipts.release(id, etag, actor.userId));
  }

  private assertOwner(
    action: "warehouse.receipt.pledge" | "warehouse.receipt.transfer",
    actor: ActorContext,
    receipt: WarehouseReceipt,
  ): void {
    this.assert(action, actor, "active", receipt.ownerOrganizationId);
  }

  private assert(
    action:
      | "warehouse.receipt.issue"
      | "warehouse.receipt.view"
      | "warehouse.receipt.pledge"
      | "warehouse.receipt.pledge.release"
      | "warehouse.receipt.transfer"
      | "warehouse.receipt.release",
    actor: ActorContext,
    status: EntityStatus,
    organizationId: string,
    assignmentId?: string,
  ): void {
    const decision = authorize({
      action,
      actor,
      entityStatus: status,
      resourceOrganizationId: organizationId,
      ...(assignmentId === undefined ? {} : { assignmentId }),
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }
  }

  private async requireReceipt(id: string): Promise<WarehouseReceipt> {
    const receipt = await this.receipts.get(id);
    if (receipt === undefined) {
      throw new NotFoundException("Warehouse receipt not found");
    }
    return receipt;
  }

  private async requireActiveReceipt(id: string): Promise<WarehouseReceipt> {
    const receipt = await this.requireReceipt(id);
    if (receipt.status !== "active") {
      throw new BadRequestException("Warehouse receipt is no longer active");
    }
    return receipt;
  }

  private async requireActiveOrganization(id: string): Promise<void> {
    const organization = await this.organizations.get(id);
    if (organization === undefined || organization.status !== "active") {
      throw new BadRequestException("Target organization is not active");
    }
  }

  private async mapConflict(
    operation: () => Promise<WarehouseReceipt>,
  ): Promise<WarehouseReceipt> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof WarehouseReceiptConflictError) {
        throw new ConflictException("The receipt changed; refresh and retry");
      }
      throw error;
    }
  }
}

function receiptStatus(status: WarehouseReceipt["status"]): EntityStatus {
  return status === "active" ? "active" : "inactive";
}

function sameQuantity(left: LotQuantity, right: LotQuantity): boolean {
  return (
    left.value === right.value &&
    left.scale === right.scale &&
    left.unitCode === right.unitCode
  );
}