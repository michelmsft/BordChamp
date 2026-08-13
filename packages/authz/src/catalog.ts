import type { EntityStatus, Persona } from "@bordchamp/domain";

export type PermissionScope =
  | "public"
  | "authenticated"
  | "ownOrganization"
  | "representedOrganization"
  | "assigned"
  | "all";

export type PermissionAction =
  | "referenceData.view"
  | "referenceData.manage"
  | "marketData.snapshot.view"
  | "profile.viewOwn"
  | "organization.create"
  | "organization.view"
  | "organization.update"
  | "organization.mandate.manage"
  | "productionUnit.create"
  | "productionUnit.view"
  | "productionUnit.update"
  | "inventory.lot.view"
  | "inventory.lot.create"
  | "inventory.lot.update"
  | "inventory.lot.quarantine"
  | "inspection.request"
  | "inspection.view"
  | "inspection.submit"
  | "warehouse.receipt.issue"
  | "warehouse.receipt.view"
  | "warehouse.receipt.pledge"
  | "warehouse.receipt.pledge.release"
  | "warehouse.receipt.transfer"
  | "warehouse.receipt.release"
  | "trading.rfq.create"
  | "trading.rfq.view"
  | "trading.rfq.quote"
  | "trading.rfq.accept"
  | "trading.rfq.cancel"
  | "settlement.initialize"
  | "settlement.view"
  | "settlement.manage"
  | "delivery.create"
  | "delivery.view"
  | "delivery.update"
  | "delivery.receive"
  | "dispute.file"
  | "dispute.view"
  | "dispute.participate"
  | "dispute.resolve"
  | "compliance.document.submit"
  | "compliance.document.view"
  | "compliance.document.review"
  | "traceability.lineage.register"
  | "traceability.view"
  | "compliance.hold.manage"
  | "risk.limit.view"
  | "risk.limit.manage"
  | "risk.alert.view"
  | "risk.alert.acknowledge"
  | "risk.alert.resolve"
  | "webhook.subscription.public.manage"
  | "webhook.subscription.private.manage"
  | "webhook.attempt.view"
  | "webhook.attempt.replay"
  | "reports.view"
  | "auditLog.viewOwn"
  | "entity.deactivate"
  | "auditLog.view";

export interface PermissionDefinition {
  readonly public: boolean;
  readonly personas: readonly Persona[];
  readonly scopes: readonly PermissionScope[];
  readonly allowedEntityStatuses: readonly EntityStatus[];
}

const allStatuses: readonly EntityStatus[] = [
  "active",
  "windDown",
  "suspended",
  "inactive",
];

export const permissionCatalog = {
  "referenceData.view": {
    public: true,
    personas: [],
    scopes: ["public"],
    allowedEntityStatuses: allStatuses,
  },
  "referenceData.manage": {
    public: false,
    personas: ["ExchangeAdmin"],
    scopes: ["all"],
    allowedEntityStatuses: ["active"],
  },
  "marketData.snapshot.view": {
    public: true,
    personas: [],
    scopes: ["public"],
    allowedEntityStatuses: allStatuses,
  },
  "profile.viewOwn": {
    public: false,
    personas: [],
    scopes: ["authenticated"],
    allowedEntityStatuses: allStatuses,
  },
  "organization.create": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "LogisticsProvider",
      "ExchangeAdmin",
    ],
    scopes: ["authenticated"],
    allowedEntityStatuses: ["active"],
  },
  "organization.view": {
    public: false,
    personas: [],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "organization.update": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "LogisticsProvider",
      "ExchangeAdmin",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: ["active"],
  },
  "organization.mandate.manage": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "ExchangeAdmin",
    ],
    scopes: ["ownOrganization", "all"],
    allowedEntityStatuses: ["active"],
  },
  "productionUnit.create": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "productionUnit.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Inspector",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "assigned", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "productionUnit.update": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "inventory.lot.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: [
      "ownOrganization",
      "representedOrganization",
      "assigned",
      "all",
    ],
    allowedEntityStatuses: allStatuses,
  },
  "inventory.lot.create": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "inventory.lot.update": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "inventory.lot.quarantine": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Inspector",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: [
      "ownOrganization",
      "representedOrganization",
      "assigned",
      "all",
    ],
    allowedEntityStatuses: ["active"],
  },
  "inspection.request": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "inspection.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Inspector",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "assigned", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "inspection.submit": {
    public: false,
    personas: ["Inspector"],
    scopes: ["assigned"],
    allowedEntityStatuses: ["active"],
  },
  "warehouse.receipt.issue": {
    public: false,
    personas: ["WarehouseOperator"],
    scopes: ["ownOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "warehouse.receipt.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "assigned", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "warehouse.receipt.pledge": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "warehouse.receipt.pledge.release": {
    public: false,
    personas: ["Trader", "Buyer", "ExchangeAdmin"],
    scopes: ["ownOrganization", "all"],
    allowedEntityStatuses: ["active"],
  },
  "warehouse.receipt.transfer": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "warehouse.receipt.release": {
    public: false,
    personas: ["WarehouseOperator"],
    scopes: ["ownOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "trading.rfq.create": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Broker"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "trading.rfq.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "trading.rfq.quote": {
    public: false,
    personas: ["Trader", "Broker", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "trading.rfq.accept": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Broker"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "trading.rfq.cancel": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Broker"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "settlement.initialize": {
    public: false,
    personas: ["Trader", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "settlement.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "settlement.manage": {
    public: false,
    personas: ["ExchangeAdmin"],
    scopes: ["all"],
    allowedEntityStatuses: ["active", "suspended"],
  },
  "delivery.create": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "delivery.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Buyer",
      "LogisticsProvider",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "assigned", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "delivery.update": {
    public: false,
    personas: ["LogisticsProvider"],
    scopes: ["assigned"],
    allowedEntityStatuses: ["active"],
  },
  "delivery.receive": {
    public: false,
    personas: ["Trader", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "dispute.file": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "dispute.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Buyer",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "dispute.participate": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader", "Buyer"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "dispute.resolve": {
    public: false,
    personas: ["ExchangeAdmin"],
    scopes: ["all"],
    allowedEntityStatuses: ["active", "suspended"],
  },
  "compliance.document.submit": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "LogisticsProvider",
    ],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "compliance.document.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "LogisticsProvider",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "compliance.document.review": {
    public: false,
    personas: ["ExchangeAdmin"],
    scopes: ["all"],
    allowedEntityStatuses: ["active", "suspended"],
  },
  "traceability.lineage.register": {
    public: false,
    personas: ["Farmer", "CooperativeManager", "Trader"],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: ["active"],
  },
  "traceability.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "compliance.hold.manage": {
    public: false,
    personas: ["ExchangeAdmin", "Regulator"],
    scopes: ["all"],
    allowedEntityStatuses: ["active", "suspended", "inactive"],
  },
  "risk.limit.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "risk.limit.manage": {
    public: false,
    personas: ["ExchangeAdmin"],
    scopes: ["all"],
    allowedEntityStatuses: allStatuses,
  },
  "risk.alert.view": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "LogisticsProvider",
      "ExchangeAdmin",
      "Regulator",
    ],
    scopes: ["ownOrganization", "representedOrganization", "assigned", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "risk.alert.acknowledge": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "LogisticsProvider",
    ],
    scopes: ["ownOrganization", "representedOrganization", "assigned"],
    allowedEntityStatuses: ["active", "suspended"],
  },
  "risk.alert.resolve": {
    public: false,
    personas: ["ExchangeAdmin"],
    scopes: ["all"],
    allowedEntityStatuses: ["active", "suspended"],
  },
  "webhook.subscription.public.manage": {
    public: false,
    personas: [],
    scopes: ["authenticated"],
    allowedEntityStatuses: allStatuses,
  },
  "webhook.subscription.private.manage": {
    public: false,
    personas: [
      "Farmer",
      "CooperativeManager",
      "Trader",
      "Broker",
      "Buyer",
      "WarehouseOperator",
      "Inspector",
      "LogisticsProvider",
      "ExchangeAdmin",
    ],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: ["active"],
  },
  "webhook.attempt.view": {
    public: false,
    personas: [],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "webhook.attempt.replay": {
    public: false,
    personas: [],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: ["active", "suspended"],
  },
  "reports.view": {
    public: false,
    personas: [],
    scopes: ["ownOrganization", "representedOrganization", "all"],
    allowedEntityStatuses: allStatuses,
  },
  "auditLog.viewOwn": {
    public: false,
    personas: [],
    scopes: ["ownOrganization", "representedOrganization"],
    allowedEntityStatuses: allStatuses,
  },
  "entity.deactivate": {
    public: false,
    personas: ["ExchangeAdmin"],
    scopes: ["all"],
    allowedEntityStatuses: ["active", "windDown", "suspended"],
  },
  "auditLog.view": {
    public: false,
    personas: ["ExchangeAdmin", "Regulator"],
    scopes: ["all"],
    allowedEntityStatuses: allStatuses,
  },
} as const satisfies Record<PermissionAction, PermissionDefinition>;