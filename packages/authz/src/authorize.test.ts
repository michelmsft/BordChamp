import type { ActorContext, Persona } from "@bordchamp/domain";
import { describe, expect, it } from "vitest";

import { authorize } from "./authorize.js";

function actor(
  persona: Persona,
  overrides: Partial<ActorContext> = {},
): ActorContext {
  return {
    userId: "user-1",
    organizationId: "org-1",
    personas: [persona],
    representedOrganizationIds: [],
    assignmentIds: [],
    ...overrides,
  };
}

describe("authorize", () => {
  it("allows anonymous access to explicitly public reference data", () => {
    expect(
      authorize({
        action: "referenceData.view",
        entityStatus: "active",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("allows a farmer to create a lot for their active organization", () => {
    expect(
      authorize({
        action: "inventory.lot.create",
        actor: actor("Farmer"),
        entityStatus: "active",
        resourceOrganizationId: "org-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("denies access across organizations", () => {
    expect(
      authorize({
        action: "inventory.lot.create",
        actor: actor("Farmer"),
        entityStatus: "active",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: false, reason: "scopeNotAllowed" });
  });

  it("allows a cooperative manager to act for a represented organization", () => {
    expect(
      authorize({
        action: "inventory.lot.create",
        actor: actor("CooperativeManager", {
          representedOrganizationIds: ["org-2"],
        }),
        entityStatus: "active",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("blocks new activity against a deactivated entity", () => {
    expect(
      authorize({
        action: "inventory.lot.create",
        actor: actor("Farmer"),
        entityStatus: "inactive",
        resourceOrganizationId: "org-1",
      }),
    ).toEqual({ allowed: false, reason: "entityStatusNotAllowed" });
  });

  it("allows represented lot updates but blocks quarantined lot updates", () => {
    const manager = actor("CooperativeManager", {
      representedOrganizationIds: ["org-2"],
    });

    expect(
      authorize({
        action: "inventory.lot.update",
        actor: manager,
        entityStatus: "active",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "inventory.lot.update",
        actor: manager,
        entityStatus: "suspended",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: false, reason: "entityStatusNotAllowed" });
  });

  it("allows regulators to quarantine but not update lots", () => {
    expect(
      authorize({
        action: "inventory.lot.quarantine",
        actor: actor("Regulator"),
        entityStatus: "active",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "inventory.lot.update",
        actor: actor("Regulator"),
        entityStatus: "active",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
  });

  it("allows only an assigned inspector to submit an inspection", () => {
    const assigned = actor("Inspector", { assignmentIds: ["inspection-1"] });
    const unassigned = actor("Inspector");

    expect(
      authorize({
        action: "inspection.submit",
        actor: assigned,
        entityStatus: "active",
        assignmentId: "inspection-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "inspection.submit",
        actor: unassigned,
        entityStatus: "active",
        assignmentId: "inspection-1",
      }),
    ).toEqual({ allowed: false, reason: "scopeNotAllowed" });
  });

  it("separates warehouse custody authority from receipt title authority", () => {
    const warehouse = actor("WarehouseOperator", { organizationId: "warehouse-1" });
    const owner = actor("Farmer", { organizationId: "owner-1" });

    expect(
      authorize({
        action: "warehouse.receipt.issue",
        actor: warehouse,
        entityStatus: "active",
        resourceOrganizationId: "warehouse-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "warehouse.receipt.pledge",
        actor: warehouse,
        entityStatus: "active",
        resourceOrganizationId: "owner-1",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
    expect(
      authorize({
        action: "warehouse.receipt.transfer",
        actor: owner,
        entityStatus: "active",
        resourceOrganizationId: "owner-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("separates RFQ seller acceptance from buyer quoting", () => {
    const seller = actor("Farmer", { organizationId: "seller-1" });
    const buyer = actor("Buyer", { organizationId: "buyer-1" });

    expect(
      authorize({
        action: "trading.rfq.accept",
        actor: seller,
        entityStatus: "active",
        resourceOrganizationId: "seller-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "trading.rfq.quote",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "trading.rfq.accept",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "seller-1",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
  });

  it("allows buyers to initialize settlement but reserves management for admins", () => {
    const buyer = actor("Buyer", { organizationId: "buyer-1" });
    expect(
      authorize({
        action: "settlement.initialize",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "settlement.manage",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
    expect(
      authorize({
        action: "settlement.manage",
        actor: actor("ExchangeAdmin"),
        entityStatus: "active",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("allows only assigned logistics updates and buyer receipt decisions", () => {
    const logistics = actor("LogisticsProvider", {
      assignmentIds: ["delivery-1"],
    });
    const buyer = actor("Buyer", { organizationId: "buyer-1" });
    expect(
      authorize({
        action: "delivery.update",
        actor: logistics,
        entityStatus: "active",
        assignmentId: "delivery-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "delivery.receive",
        actor: logistics,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
    expect(
      authorize({
        action: "delivery.receive",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("allows dispute parties to participate but only admins to decide", () => {
    const buyer = actor("Buyer", { organizationId: "buyer-1" });
    expect(
      authorize({
        action: "dispute.participate",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "dispute.resolve",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
    expect(
      authorize({
        action: "dispute.resolve",
        actor: actor("ExchangeAdmin"),
        entityStatus: "suspended",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("allows organization compliance submission and regulator recall authority", () => {
    const farmer = actor("Farmer", { organizationId: "farm-1" });
    expect(
      authorize({
        action: "compliance.document.submit",
        actor: farmer,
        entityStatus: "active",
        resourceOrganizationId: "farm-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "compliance.document.review",
        actor: farmer,
        entityStatus: "active",
        resourceOrganizationId: "farm-1",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
    expect(
      authorize({
        action: "compliance.hold.manage",
        actor: actor("Regulator"),
        entityStatus: "active",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("allows participants to acknowledge risk alerts but only admins to resolve", () => {
    const buyer = actor("Buyer", { organizationId: "buyer-1" });
    expect(
      authorize({
        action: "risk.alert.acknowledge",
        actor: buyer,
        entityStatus: "suspended",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "risk.alert.resolve",
        actor: buyer,
        entityStatus: "suspended",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: false, reason: "personaNotAllowed" });
    expect(
      authorize({
        action: "risk.limit.manage",
        actor: actor("ExchangeAdmin"),
        entityStatus: "active",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("allows public subscriptions broadly but scopes private reports and audit", () => {
    const consumer = actor("DataConsumer");
    const buyer = actor("Buyer", { organizationId: "buyer-1" });
    expect(
      authorize({
        action: "webhook.subscription.public.manage",
        actor: consumer,
        entityStatus: "active",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "reports.view",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-2",
      }),
    ).toEqual({ allowed: false, reason: "scopeNotAllowed" });
    expect(
      authorize({
        action: "auditLog.viewOwn",
        actor: buyer,
        entityStatus: "active",
        resourceOrganizationId: "buyer-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("preserves authorized historical reads for inactive entities", () => {
    expect(
      authorize({
        action: "inventory.lot.view",
        actor: actor("Farmer"),
        entityStatus: "inactive",
        resourceOrganizationId: "org-1",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("allows represented organization reads and updates only while active", () => {
    const manager = actor("CooperativeManager", {
      representedOrganizationIds: ["org-2"],
    });

    expect(
      authorize({
        action: "organization.view",
        actor: manager,
        entityStatus: "inactive",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: true, reason: "allowed" });
    expect(
      authorize({
        action: "organization.update",
        actor: manager,
        entityStatus: "inactive",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: false, reason: "entityStatusNotAllowed" });
  });

  it("denies organization reads outside the actor scope", () => {
    expect(
      authorize({
        action: "organization.view",
        actor: actor("Buyer"),
        entityStatus: "active",
        resourceOrganizationId: "org-2",
      }),
    ).toEqual({ allowed: false, reason: "scopeNotAllowed" });
  });

  it("allows only an exchange administrator to deactivate entities", () => {
    const request = {
      action: "entity.deactivate" as const,
      entityStatus: "active" as const,
    };

    expect(authorize({ ...request, actor: actor("ExchangeAdmin") })).toEqual({
      allowed: true,
      reason: "allowed",
    });
    expect(authorize({ ...request, actor: actor("Regulator") })).toEqual({
      allowed: false,
      reason: "personaNotAllowed",
    });
  });
});