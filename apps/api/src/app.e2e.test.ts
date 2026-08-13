import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "./app.module.js";

describe("BordChamp API", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.ESCROW_WEBHOOK_SECRET = "bordchamp-test-secret-2026";
    process.env.WEBHOOK_SIGNING_MASTER_SECRET =
      "bordchamp-webhook-master-secret-2026";
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("reports service health", async () => {
    await request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({ status: "ok" });
  });

  it("publishes anonymous commodity reference data with public labels", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/public/reference-data/commodities")
      .expect(200);

    expect(response.body.data).toHaveLength(4);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TOMATO",
          category: "crop",
          public: true,
        }),
        expect.objectContaining({
          code: "TILAPIA",
          category: "aquaculture",
          public: true,
        }),
      ]),
    );
  });

  it("protects private APIs and provisions authenticated user onboarding", async () => {
    await request(app.getHttpServer())
      .post("/v1/organizations")
      .send({ name: "Anonymous Organization", type: "farmer" })
      .expect(401);

    const subject = `onboarding-user-${Date.now()}`;
    const authenticated = {
      "x-user-id": subject,
      "x-personas": "Farmer",
    };
    const initial = await request(app.getHttpServer())
      .get("/v1/me")
      .set(authenticated)
      .expect(200);
    expect(initial.body.data.profile.onboardingState).toBe("profileRequired");

    const profile = await request(app.getHttpServer())
      .post("/v1/me/onboarding/complete")
      .set(authenticated)
      .set("If-Match", initial.body.data.profile.etag as string)
      .send({
        givenName: "Awa",
        surname: "Koné",
        displayName: "Awa Koné",
        locale: "fr-CI",
      })
      .expect(201);
    expect(profile.body.data.onboardingState).toBe("organizationRequired");

    const organization = await request(app.getHttpServer())
      .post("/v1/onboarding/organization")
      .set(authenticated)
      .send({ name: `Ferme Onboarding ${Date.now()}`, type: "farmer" })
      .expect(201);
    expect(organization.body.data.membership.role).toBe("owner");
    expect(organization.body.data.membership.personas).toEqual(["Farmer"]);
    expect(organization.body.data.profile.onboardingState).toBe("complete");
  });

  it("enforces organization scope, mandates, ETags, and safe deactivation", async () => {
    const farmerHeaders = {
      "x-user-id": "farmer-1",
      "x-personas": "Farmer",
    };
    const created = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set(farmerHeaders)
      .send({ name: "Ferme Lagune", type: "farmer" })
      .expect(201);

    const organizationId = created.body.data.id as string;
    const firstEtag = created.headers.etag as string;
    const ownerHeaders = {
      ...farmerHeaders,
      "x-organization-id": organizationId,
    };

    await request(app.getHttpServer())
      .get(`/v1/organizations/${organizationId}`)
      .set(ownerHeaders)
      .expect(200);

    const updated = await request(app.getHttpServer())
      .patch(`/v1/organizations/${organizationId}`)
      .set(ownerHeaders)
      .set("If-Match", firstEtag)
      .send({ name: "Ferme Lagune Bio" })
      .expect(200);
    const updatedEtag = updated.headers.etag as string;

    await request(app.getHttpServer())
      .patch(`/v1/organizations/${organizationId}`)
      .set(ownerHeaders)
      .set("If-Match", firstEtag)
      .send({ name: "Stale update" })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/v1/organizations/${organizationId}/mandates`)
      .set(ownerHeaders)
      .send({ granteeUserId: "manager-1" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/v1/organizations/${organizationId}`)
      .set("x-user-id", "manager-1")
      .set("x-personas", "CooperativeManager")
      .expect(200);

    const deactivated = await request(app.getHttpServer())
      .post(`/v1/organizations/${organizationId}/deactivate`)
      .set("x-user-id", "admin-1")
      .set("x-personas", "ExchangeAdmin")
      .set("If-Match", updatedEtag)
      .send({ reason: "Pilot account closed" })
      .expect(200);
    expect(deactivated.body.data.status).toBe("inactive");

    await request(app.getHttpServer())
      .patch(`/v1/organizations/${organizationId}`)
      .set(ownerHeaders)
      .set("If-Match", deactivated.headers.etag as string)
      .send({ name: "Forbidden update" })
      .expect(403);

    const historical = await request(app.getHttpServer())
      .get(`/v1/organizations/${organizationId}`)
      .set(ownerHeaders)
      .expect(200);
    expect(historical.body.data.name).toBe("Ferme Lagune Bio");
    expect(historical.body.data.status).toBe("inactive");
  });

  it("manages an aquaculture lot through availability, quarantine, and deactivation", async () => {
    const farmerHeaders = {
      "x-user-id": "fish-farmer-1",
      "x-personas": "Farmer",
    };
    const organization = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set(farmerHeaders)
      .send({ name: "Ferme Piscicole Ebrié", type: "farmer" })
      .expect(201);
    const organizationId = organization.body.data.id as string;
    const ownerHeaders = {
      ...farmerHeaders,
      "x-organization-id": organizationId,
    };

    await request(app.getHttpServer())
      .post(`/v1/organizations/${organizationId}/mandates`)
      .set(ownerHeaders)
      .send({ granteeUserId: "fish-manager-1" })
      .expect(201);
    const managerHeaders = {
      "x-user-id": "fish-manager-1",
      "x-personas": "CooperativeManager",
    };

    await request(app.getHttpServer())
      .post("/v1/production-units")
      .set(managerHeaders)
      .send({
        ownerOrganizationId: organizationId,
        type: "pond",
        name: "Invalid crop pond",
        supportedCategory: "crop",
      })
      .expect(400);

    const productionUnit = await request(app.getHttpServer())
      .post("/v1/production-units")
      .set(managerHeaders)
      .send({
        ownerOrganizationId: organizationId,
        type: "pond",
        name: "Étang 7",
        supportedCategory: "aquaculture",
      })
      .expect(201);
    const productionUnitId = productionUnit.body.data.id as string;

    await request(app.getHttpServer())
      .post("/v1/inventory/lots")
      .set(managerHeaders)
      .send({
        ownerOrganizationId: organizationId,
        category: "liveAnimal",
        commodityCode: "TILAPIA",
        quantity: { value: 10, scale: 0, unitCode: "COUNT" },
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post("/v1/inventory/lots")
      .set(managerHeaders)
      .send({
        ownerOrganizationId: organizationId,
        category: "aquaculture",
        commodityCode: "TILAPIA",
        productionUnitId,
        quantity: { value: 125_500, scale: 3, unitCode: "KG" },
      })
      .expect(201);
    const lotId = created.body.data.id as string;
    const firstEtag = created.body.data.etag as string;
    expect(created.body.data.status).toBe("draft");
    expect(created.body.data.quantity).toEqual({
      value: 125_500,
      scale: 3,
      unitCode: "KG",
    });

    const workspace = await request(app.getHttpServer())
      .get(`/v1/erp/organizations/${organizationId}/workspace`)
      .set(ownerHeaders)
      .expect(200);
    expect(workspace.body.data.organizationId).toBe(organizationId);
    if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
      expect(
        workspace.body.data.productionUnits.some(
          (unit: { id: string }) => unit.id === productionUnitId,
        ),
      ).toBe(true);
      expect(
        workspace.body.data.lots.some(
          (lot: { id: string }) => lot.id === lotId,
        ),
      ).toBe(true);
    }

    const quantityUpdated = await request(app.getHttpServer())
      .patch(`/v1/inventory/lots/${lotId}/quantity`)
      .set(ownerHeaders)
      .set("If-Match", firstEtag)
      .send({ value: 126_000, scale: 3, unitCode: "KG" })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/v1/inventory/lots/${lotId}/quantity`)
      .set(ownerHeaders)
      .set("If-Match", firstEtag)
      .send({ value: 127_000, scale: 3, unitCode: "KG" })
      .expect(409);

    const available = await request(app.getHttpServer())
      .post(`/v1/inventory/lots/${lotId}/mark-available`)
      .set(ownerHeaders)
      .set("If-Match", quantityUpdated.body.data.etag as string)
      .expect(200);
    expect(available.body.data.status).toBe("available");

    const requestedInspection = await request(app.getHttpServer())
      .post("/v1/inspections")
      .set(ownerHeaders)
      .send({
        lotId,
        type: "aquacultureHealth",
        assignedInspectorUserId: "inspector-1",
      })
      .expect(201);
    const inspectionId = requestedInspection.body.data.id as string;
    const inspectionEtag = requestedInspection.body.data.etag as string;

    await request(app.getHttpServer())
      .post(`/v1/inspections/${inspectionId}/finalize`)
      .set("x-user-id", "inspector-2")
      .set("x-personas", "Inspector")
      .set("If-Match", inspectionEtag)
      .send({
        outcome: "fail",
        certificateNumber: "CERT-WRONG-1",
        findings: [
          {
            code: "WATER_QUALITY",
            result: "fail",
            notes: "Contamination suspected",
          },
        ],
      })
      .expect(403);

    const finalizedInspection = await request(app.getHttpServer())
      .post(`/v1/inspections/${inspectionId}/finalize`)
      .set("x-user-id", "inspector-1")
      .set("x-personas", "Inspector")
      .set("If-Match", inspectionEtag)
      .send({
        outcome: "fail",
        certificateNumber: "CERT-AQ-2026-001",
        findings: [
          {
            code: "WATER_QUALITY",
            result: "fail",
            notes: "Suspected water contamination",
          },
        ],
      })
      .expect(200);
    expect(finalizedInspection.body.data.status).toBe("finalized");
    expect(finalizedInspection.body.data.lotHoldApplied).toBe(true);

    await request(app.getHttpServer())
      .post(`/v1/inspections/${inspectionId}/finalize`)
      .set("x-user-id", "inspector-1")
      .set("x-personas", "Inspector")
      .set("If-Match", finalizedInspection.body.data.etag as string)
      .send({
        outcome: "pass",
        certificateNumber: "CERT-REWRITE-1",
        findings: [{ code: "WATER_QUALITY", result: "pass" }],
      })
      .expect(400);

    const quarantined = await request(app.getHttpServer())
      .get(`/v1/inventory/lots/${lotId}`)
      .set(ownerHeaders)
      .expect(200);
    expect(quarantined.body.data.status).toBe("quarantined");

    await request(app.getHttpServer())
      .patch(`/v1/inventory/lots/${lotId}/quantity`)
      .set(ownerHeaders)
      .set("If-Match", quarantined.body.data.etag as string)
      .send({ value: 128_000, scale: 3, unitCode: "KG" })
      .expect(403);

    const deactivated = await request(app.getHttpServer())
      .post(`/v1/inventory/lots/${lotId}/deactivate`)
      .set("x-user-id", "admin-2")
      .set("x-personas", "ExchangeAdmin")
      .set("If-Match", quarantined.body.data.etag as string)
      .send({ reason: "Batch disposed after investigation" })
      .expect(200);
    expect(deactivated.body.data.status).toBe("inactive");

    const historical = await request(app.getHttpServer())
      .get(`/v1/inventory/lots/${lotId}`)
      .set(ownerHeaders)
      .expect(200);
    expect(historical.body.data.status).toBe("inactive");
    expect(historical.body.data.quarantineReason).toBe(
      `Inspection ${inspectionId} failed`,
    );
  });

  it("enforces warehouse receipt custody, pledge, transfer, and release controls", async () => {
    const farmer = { "x-user-id": "store-farmer-1", "x-personas": "Farmer" };
    const farmerOrganization = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set(farmer)
      .send({ name: "Ferme Maraîchère Sud", type: "farmer" })
      .expect(201);
    const farmerOrganizationId = farmerOrganization.body.data.id as string;
    const farmerOwner = {
      ...farmer,
      "x-organization-id": farmerOrganizationId,
    };

    const warehouseOrganization = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set("x-user-id", "warehouse-user-1")
      .set("x-personas", "WarehouseOperator")
      .send({ name: "Entrepôt Frais Abidjan", type: "warehouse" })
      .expect(201);
    const warehouseOrganizationId = warehouseOrganization.body.data.id as string;
    const warehouse = {
      "x-user-id": "warehouse-user-1",
      "x-personas": "WarehouseOperator",
      "x-organization-id": warehouseOrganizationId,
    };

    const buyerOrganization = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set("x-user-id", "buyer-user-1")
      .set("x-personas", "Buyer")
      .send({ name: "Acheteur Marché Central", type: "buyer" })
      .expect(201);
    const buyerOrganizationId = buyerOrganization.body.data.id as string;
    const buyer = {
      "x-user-id": "buyer-user-1",
      "x-personas": "Buyer",
      "x-organization-id": buyerOrganizationId,
    };

    const createAvailableLot = async () => {
      const created = await request(app.getHttpServer())
        .post("/v1/inventory/lots")
        .set(farmerOwner)
        .send({
          ownerOrganizationId: farmerOrganizationId,
          category: "crop",
          commodityCode: "TOMATO",
          quantity: { value: 2_500, scale: 1, unitCode: "KG" },
        })
        .expect(201);
      return request(app.getHttpServer())
        .post(`/v1/inventory/lots/${created.body.data.id as string}/mark-available`)
        .set(farmerOwner)
        .set("If-Match", created.body.data.etag as string)
        .expect(200);
    };

    const availableLot = await createAvailableLot();
    const receipt = await request(app.getHttpServer())
      .post("/v1/warehouse-receipts")
      .set(warehouse)
      .send({
        warehouseOrganizationId,
        lotId: availableLot.body.data.id,
        quantity: { value: 2_500, scale: 1, unitCode: "KG" },
      })
      .expect(201);
    const receiptId = receipt.body.data.id as string;
    const receiptEtag = receipt.body.data.etag as string;

    await request(app.getHttpServer())
      .post("/v1/warehouse-receipts")
      .set(warehouse)
      .send({
        warehouseOrganizationId,
        lotId: availableLot.body.data.id,
        quantity: { value: 2_500, scale: 1, unitCode: "KG" },
      })
      .expect(409);

    const pledged = await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/pledge`)
      .set(farmerOwner)
      .set("If-Match", receiptEtag)
      .send({
        pledgeeOrganizationId: buyerOrganizationId,
        pledgeReference: "PLEDGE-2026-001",
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/transfer`)
      .set(farmerOwner)
      .set("If-Match", pledged.body.data.etag as string)
      .send({ newOwnerOrganizationId: buyerOrganizationId })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/release`)
      .set(warehouse)
      .set("If-Match", pledged.body.data.etag as string)
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/release-pledge`)
      .set(farmerOwner)
      .set("If-Match", pledged.body.data.etag as string)
      .send({ reason: "Owner cannot self-release" })
      .expect(403);

    const unpledged = await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/release-pledge`)
      .set(buyer)
      .set("If-Match", pledged.body.data.etag as string)
      .send({ reason: "Secured obligation settled" })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/transfer`)
      .set(farmerOwner)
      .set("If-Match", receiptEtag)
      .send({ newOwnerOrganizationId: buyerOrganizationId })
      .expect(409);

    const transferred = await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/transfer`)
      .set(farmerOwner)
      .set("If-Match", unpledged.body.data.etag as string)
      .send({ newOwnerOrganizationId: buyerOrganizationId })
      .expect(200);
    expect(transferred.body.data.ownerOrganizationId).toBe(buyerOrganizationId);

    const released = await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${receiptId}/release`)
      .set(warehouse)
      .set("If-Match", transferred.body.data.etag as string)
      .expect(200);
    expect(released.body.data.status).toBe("released");

    await request(app.getHttpServer())
      .get(`/v1/warehouse-receipts/${receiptId}`)
      .set(buyer)
      .expect(200);

    await request(app.getHttpServer())
      .post("/v1/trading/rfqs")
      .set(farmerOwner)
      .send({
        lotId: availableLot.body.data.id,
        invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(403);

    const heldLot = await createAvailableLot();
    const heldReceipt = await request(app.getHttpServer())
      .post("/v1/warehouse-receipts")
      .set(warehouse)
      .send({
        warehouseOrganizationId,
        lotId: heldLot.body.data.id,
        quantity: { value: 2_500, scale: 1, unitCode: "KG" },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/inventory/lots/${heldLot.body.data.id as string}/quarantine`)
      .set("x-user-id", "warehouse-regulator-1")
      .set("x-personas", "Regulator")
      .set("If-Match", heldLot.body.data.etag as string)
      .send({ reason: "Recall pending investigation" })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/warehouse-receipts/${heldReceipt.body.data.id as string}/release`)
      .set(warehouse)
      .set("If-Match", heldReceipt.body.data.etag as string)
      .expect(400);
  });

  it("executes an invited sell RFQ and prevents double sale", async () => {
    const sellerIdentity = { "x-user-id": "rfq-seller-1", "x-personas": "Farmer" };
    const sellerOrg = await request(app.getHttpServer()).post("/v1/organizations")
      .set(sellerIdentity).send({ name: "Producteur RFQ", type: "farmer" }).expect(201);
    const sellerOrganizationId = sellerOrg.body.data.id as string;
    const seller = { ...sellerIdentity, "x-organization-id": sellerOrganizationId };

    const buyerIdentity = { "x-user-id": "rfq-buyer-1", "x-personas": "Buyer" };
    const buyerOrg = await request(app.getHttpServer()).post("/v1/organizations")
      .set(buyerIdentity).send({ name: "Acheteur RFQ", type: "buyer" }).expect(201);
    const buyerOrganizationId = buyerOrg.body.data.id as string;
    const buyer = { ...buyerIdentity, "x-organization-id": buyerOrganizationId };

    const tradeWebhook = await request(app.getHttpServer())
      .post("/v1/integrations/webhooks")
      .set(buyer)
      .send({
        endpoint: "https://hooks.example.invalid/bordchamp/trades",
        topics: ["private.trade.executed"],
      })
      .expect(201);
    const tradeWebhookSecret = tradeWebhook.body.data.signingSecret as string;

    const outsiderIdentity = { "x-user-id": "rfq-outsider-1", "x-personas": "Buyer" };
    const outsiderOrg = await request(app.getHttpServer()).post("/v1/organizations")
      .set(outsiderIdentity).send({ name: "Acheteur Non Invité", type: "buyer" }).expect(201);
    const outsider = { ...outsiderIdentity, "x-organization-id": outsiderOrg.body.data.id as string };

    const logisticsIdentity = {
      "x-user-id": "delivery-driver-1",
      "x-personas": "LogisticsProvider",
    };
    const logisticsOrg = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set(logisticsIdentity)
      .send({ name: "Transport Frais RFQ", type: "logisticsProvider" })
      .expect(201);
    const logisticsOrganizationId = logisticsOrg.body.data.id as string;
    const logistics = {
      ...logisticsIdentity,
      "x-organization-id": logisticsOrganizationId,
    };

    const createAvailableLot = async () => {
      const lot = await request(app.getHttpServer()).post("/v1/inventory/lots")
        .set(seller).send({ ownerOrganizationId: sellerOrganizationId, category: "crop",
          commodityCode: "TOMATO", quantity: { value: 1_000, scale: 1, unitCode: "KG" } }).expect(201);
      return request(app.getHttpServer()).post(`/v1/inventory/lots/${lot.body.data.id as string}/mark-available`)
        .set(seller).set("If-Match", lot.body.data.etag as string).expect(200);
    };

    const available = await createAvailableLot();
    const rfq = await request(app.getHttpServer()).post("/v1/trading/rfqs")
      .set(seller).send({ lotId: available.body.data.id,
        invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201);
    const rfqId = rfq.body.data.id as string;
    expect((await request(app.getHttpServer()).get(`/v1/inventory/lots/${available.body.data.id as string}`)
      .set(seller).expect(200)).body.data.status).toBe("reserved");

    await request(app.getHttpServer()).post(`/v1/trading/rfqs/${rfqId}/quotes`)
      .set(outsider).send({ unitPriceMinor: 800 }).expect(403);
    const quote = await request(app.getHttpServer()).post(`/v1/trading/rfqs/${rfqId}/quotes`)
      .set(buyer).send({ unitPriceMinor: 800 }).expect(201);
    expect(quote.body.data.grossAmountMinor).toBe(80_000);
    expect(quote.body.data.feeAmountMinor).toBe(800);
    expect(quote.body.data.totalAmountMinor).toBe(80_800);

    const initialBuyerLimits = await request(app.getHttpServer())
      .put(`/v1/risk/organizations/${buyerOrganizationId}/limits`)
      .set("x-user-id", "risk-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .send({
        maxTradeValueMinor: 50_000,
        maxOpenDeliveryExposureMinor: 100_000,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${rfqId}/accept`)
      .set(seller)
      .set("If-Match", rfq.body.data.etag as string)
      .send({ quoteId: quote.body.data.id })
      .expect(409);
    const buyerAlerts = await request(app.getHttpServer())
      .get(`/v1/risk/organizations/${buyerOrganizationId}/alerts`)
      .set(buyer)
      .expect(200);
    const limitAlert = buyerAlerts.body.data.find(
      (alert: { type: string }) => alert.type === "TRADE_LIMIT_BREACH",
    );
    expect(limitAlert.severity).toBe("critical");
    const acknowledged = await request(app.getHttpServer())
      .post(
        `/v1/risk/organizations/${buyerOrganizationId}/alerts/${limitAlert.id}/acknowledge`,
      )
      .set(buyer)
      .set("If-Match", limitAlert.etag)
      .expect(200);
    expect(acknowledged.body.data.status).toBe("acknowledged");
    const raisedBuyerLimits = await request(app.getHttpServer())
      .put(`/v1/risk/organizations/${buyerOrganizationId}/limits`)
      .set("x-user-id", "risk-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .set("If-Match", initialBuyerLimits.body.data.etag as string)
      .send({
        maxTradeValueMinor: 200_000,
        maxOpenDeliveryExposureMinor: 100_000,
      })
      .expect(200);
    expect(raisedBuyerLimits.body.data.maxTradeValueMinor).toBe(200_000);

    const accepted = await request(app.getHttpServer()).post(`/v1/trading/rfqs/${rfqId}/accept`)
      .set(seller).set("If-Match", rfq.body.data.etag as string)
      .send({ quoteId: quote.body.data.id }).expect(200);
    expect(accepted.body.data.rfq.status).toBe("accepted");
    expect(accepted.body.data.trade.currencyCode).toBe("XOF");
    expect(accepted.body.data.trade.buyerOrganizationId).toBe(buyerOrganizationId);

    const privateFeed = await request(app.getHttpServer())
      .get("/v1/integrations/events/private?limit=20")
      .set(buyer)
      .expect(200);
    expect(privateFeed.body.public).toBe(false);
    expect(
      privateFeed.body.data.some(
        (event: { topic: string; subjectId: string }) =>
          event.topic === "private.trade.executed" &&
          event.subjectId === accepted.body.data.trade.id,
      ),
    ).toBe(true);

    const webhookAttempts = await request(app.getHttpServer())
      .get("/v1/integrations/webhook-attempts")
      .set(buyer)
      .expect(200);
    const tradeAttempt = webhookAttempts.body.data.find(
      (attempt: { topic: string }) =>
        attempt.topic === "private.trade.executed",
    );
    expect(tradeAttempt).toBeDefined();
    expect(
      createHmac("sha256", tradeWebhookSecret)
        .update(
          `${tradeAttempt.eventId}.${tradeAttempt.sequenceId}.${tradeAttempt.payloadJson}`,
        )
        .digest("hex"),
    ).toBe(tradeAttempt.signature);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    const retryScheduled = await request(app.getHttpServer())
      .post(
        `/v1/integrations/webhook-attempts/${encodeURIComponent(tradeAttempt.id)}/dispatch`,
      )
      .set(buyer)
      .expect(200);
    expect(retryScheduled.body.data.status).toBe("retryScheduled");
    const replayed = await request(app.getHttpServer())
      .post(
        `/v1/integrations/webhook-attempts/${encodeURIComponent(tradeAttempt.id)}/replay`,
      )
      .set(buyer)
      .expect(200);
    expect(replayed.body.data.status).toBe("pending");
    expect(replayed.body.data.replayCount).toBe(1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("accepted", { status: 200 })),
    );
    const delivered = await request(app.getHttpServer())
      .post(
        `/v1/integrations/webhook-attempts/${encodeURIComponent(tradeAttempt.id)}/dispatch`,
      )
      .set(buyer)
      .expect(200);
    expect(delivered.body.data.status).toBe("succeeded");
    expect(delivered.body.data.attemptCount).toBe(2);
    vi.unstubAllGlobals();

    const retryAccepted = await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${rfqId}/accept`)
      .set(seller)
      .set("If-Match", rfq.body.data.etag as string)
      .send({ quoteId: quote.body.data.id })
      .expect(200);
    expect(retryAccepted.body.data.trade.id).toBe(accepted.body.data.trade.id);

    const buyerView = await request(app.getHttpServer())
      .get(`/v1/trading/rfqs/${rfqId}`)
      .set(buyer)
      .expect(200);
    expect(buyerView.body.data.quotes).toHaveLength(1);

    const concurrentLot = await createAvailableLot();
    const concurrentRfq = await request(app.getHttpServer())
      .post("/v1/trading/rfqs")
      .set(seller)
      .send({
        lotId: concurrentLot.body.data.id,
        invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(201);
    const concurrentQuote = await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${concurrentRfq.body.data.id as string}/quotes`)
      .set(buyer)
      .send({ unitPriceMinor: 700 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${concurrentRfq.body.data.id as string}/accept`)
      .set(seller)
      .set("If-Match", concurrentRfq.body.data.etag as string)
      .send({ quoteId: concurrentQuote.body.data.id })
      .expect(409);
    const exposureAlerts = await request(app.getHttpServer())
      .get(`/v1/risk/organizations/${buyerOrganizationId}/alerts`)
      .set(buyer)
      .expect(200);
    expect(
      exposureAlerts.body.data.some(
        (alert: { type: string }) =>
          alert.type === "DELIVERY_EXPOSURE_BREACH",
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${concurrentRfq.body.data.id as string}/cancel`)
      .set(seller)
      .set("If-Match", concurrentRfq.body.data.etag as string)
      .send({ reason: "Exposure limit prevented acceptance" })
      .expect(200);

    const resolvedLimitAlert = await request(app.getHttpServer())
      .post(
        `/v1/risk/organizations/${buyerOrganizationId}/alerts/${limitAlert.id}/resolve`,
      )
      .set("x-user-id", "risk-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .set("If-Match", acknowledged.body.data.etag as string)
      .send({ resolution: "Buyer limit reviewed and raised" })
      .expect(200);
    expect(resolvedLimitAlert.body.data.status).toBe("resolved");

    const initializedSettlement = await request(app.getHttpServer())
      .post("/v1/settlements")
      .set(buyer)
      .send({
        rfqId,
        tradeId: accepted.body.data.trade.id,
      })
      .expect(201);
    const settlementId = initializedSettlement.body.data.id as string;
    expect(initializedSettlement.body.data.status).toBe("awaitingFunding");
    expect(initializedSettlement.body.data.providerReference).toBe(
      `FUND-${settlementId}`,
    );

    const fundingEvent = {
      eventId: `funded-${settlementId}`,
      settlementId,
      type: "FUNDED",
      providerReference: initializedSettlement.body.data.providerReference,
      occurredAt: new Date().toISOString(),
    };
    await request(app.getHttpServer())
      .post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", "invalid")
      .send(fundingEvent)
      .expect(401);

    const signProviderEvent = (event: typeof fundingEvent) =>
      createHmac("sha256", process.env.ESCROW_WEBHOOK_SECRET!)
        .update(
          [
            event.eventId,
            event.settlementId,
            event.type,
            event.providerReference,
            event.occurredAt,
          ].join("|"),
        )
        .digest("hex");
    const funded = await request(app.getHttpServer())
      .post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", signProviderEvent(fundingEvent))
      .send(fundingEvent)
      .expect(200);
    expect(funded.body.data.status).toBe("funded");
    await request(app.getHttpServer())
      .post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", signProviderEvent(fundingEvent))
      .send(fundingEvent)
      .expect(200);

    const delivery = await request(app.getHttpServer())
      .post("/v1/deliveries")
      .set(seller)
      .send({
        rfqId,
        tradeId: accepted.body.data.trade.id,
        logisticsOrganizationId,
        assignedLogisticsUserId: "delivery-driver-1",
      })
      .expect(201);
    const deliveryId = delivery.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/milestones/pickedUp`)
      .set("x-user-id", "wrong-driver")
      .set("x-personas", "LogisticsProvider")
      .set("If-Match", delivery.body.data.etag as string)
      .send({ temperatureMilliC: 5_000, location: "Seller gate" })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/milestones/inTransit`)
      .set(logistics)
      .set("If-Match", delivery.body.data.etag as string)
      .send({ temperatureMilliC: 5_000 })
      .expect(400);
    const pickedUp = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/milestones/pickedUp`)
      .set(logistics)
      .set("If-Match", delivery.body.data.etag as string)
      .send({ temperatureMilliC: 5_000, location: "Seller gate" })
      .expect(200);
    const inTransit = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/milestones/inTransit`)
      .set(logistics)
      .set("If-Match", pickedUp.body.data.etag as string)
      .send({ temperatureMilliC: 5_500, location: "Route A1" })
      .expect(200);
    const arrived = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/milestones/arrived`)
      .set(logistics)
      .set("If-Match", inTransit.body.data.etag as string)
      .send({ temperatureMilliC: 6_000, location: "Buyer dock" })
      .expect(200);
    const pod = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/pod`)
      .set(logistics)
      .set("If-Match", arrived.body.data.etag as string)
      .send({
        recipientName: "Buyer Receiver",
        evidenceReference: "blob://pod/release-1",
        temperatureMilliC: 6_000,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/decision`)
      .set(buyer)
      .set("If-Match", pod.body.data.etag as string)
      .send({
        acceptedQuantity: { value: 900, scale: 1, unitCode: "KG" },
        rejectedQuantity: { value: 50, scale: 1, unitCode: "KG" },
        rejectionReason: "Invalid quantity test",
      })
      .expect(400);
    const acceptedDelivery = await request(app.getHttpServer())
      .post(`/v1/deliveries/${deliveryId}/decision`)
      .set(buyer)
      .set("If-Match", pod.body.data.etag as string)
      .send({
        acceptedQuantity: { value: 1_000, scale: 1, unitCode: "KG" },
        rejectedQuantity: { value: 0, scale: 1, unitCode: "KG" },
      })
      .expect(200);
    expect(acceptedDelivery.body.data.status).toBe("accepted");
    expect(acceptedDelivery.body.data.settlementAction).toBe("release");
    const releasePending = await request(app.getHttpServer())
      .get(`/v1/settlements/${settlementId}`)
      .set(buyer)
      .expect(200);
    expect(releasePending.body.data.settlement.status).toBe("releasePending");
    const releaseEvent = {
      eventId: `released-${settlementId}`,
      settlementId,
      type: "RELEASED",
      providerReference: initializedSettlement.body.data.providerReference,
      occurredAt: new Date(Date.now() + 1).toISOString(),
    };
    const releasedSettlement = await request(app.getHttpServer())
      .post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", signProviderEvent(releaseEvent))
      .send(releaseEvent)
      .expect(200);
    expect(releasedSettlement.body.data.status).toBe("released");
    expect(releasedSettlement.body.data.reconciliationStatus).toBe("matched");

    const settlementView = await request(app.getHttpServer())
      .get(`/v1/settlements/${settlementId}`)
      .set(seller)
      .expect(200);
    expect(settlementView.body.data.fundingInstruction.amountMinor).toBe(80_800);
    const journals = new Map<string, { debit: number; credit: number }>();
    for (const entry of settlementView.body.data.ledger as Array<{
      journalId: string;
      side: "debit" | "credit";
      amountMinor: number;
    }>) {
      const totals = journals.get(entry.journalId) ?? { debit: 0, credit: 0 };
      totals[entry.side] += entry.amountMinor;
      journals.set(entry.journalId, totals);
    }
    expect([...journals.values()].every((value) => value.debit === value.credit)).toBe(true);

    const refundLot = await createAvailableLot();
    const refundRfq = await request(app.getHttpServer())
      .post("/v1/trading/rfqs")
      .set(seller)
      .send({
        lotId: refundLot.body.data.id,
        invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(201);
    const refundQuote = await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${refundRfq.body.data.id as string}/quotes`)
      .set(buyer)
      .send({ unitPriceMinor: 700 })
      .expect(201);
    const refundTrade = await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${refundRfq.body.data.id as string}/accept`)
      .set(seller)
      .set("If-Match", refundRfq.body.data.etag as string)
      .send({ quoteId: refundQuote.body.data.id })
      .expect(200);
    const refundSettlement = await request(app.getHttpServer())
      .post("/v1/settlements")
      .set(buyer)
      .send({
        rfqId: refundRfq.body.data.id,
        tradeId: refundTrade.body.data.trade.id,
      })
      .expect(201);
    const refundSettlementId = refundSettlement.body.data.id as string;
    const refundFundingEvent = {
      eventId: `funded-${refundSettlementId}`,
      settlementId: refundSettlementId,
      type: "FUNDED",
      providerReference: refundSettlement.body.data.providerReference,
      occurredAt: new Date(Date.now() + 2).toISOString(),
    };
    const refundFunded = await request(app.getHttpServer())
      .post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", signProviderEvent(refundFundingEvent))
      .send(refundFundingEvent)
      .expect(200);
    expect(refundFunded.body.data.status).toBe("funded");
    const refundDelivery = await request(app.getHttpServer())
      .post("/v1/deliveries")
      .set(seller)
      .send({
        rfqId: refundRfq.body.data.id,
        tradeId: refundTrade.body.data.trade.id,
        logisticsOrganizationId,
        assignedLogisticsUserId: "delivery-driver-1",
      })
      .expect(201);
    let refundDeliveryState = refundDelivery;
    for (const milestone of ["pickedUp", "inTransit", "arrived"] as const) {
      refundDeliveryState = await request(app.getHttpServer())
        .post(`/v1/deliveries/${refundDelivery.body.data.id as string}/milestones/${milestone}`)
        .set(logistics)
        .set("If-Match", refundDeliveryState.body.data.etag as string)
        .send({ temperatureMilliC: milestone === "inTransit" ? 30_000 : 8_000 })
        .expect(200);
    }
    const refundPod = await request(app.getHttpServer())
      .post(`/v1/deliveries/${refundDelivery.body.data.id as string}/pod`)
      .set(logistics)
      .set("If-Match", refundDeliveryState.body.data.etag as string)
      .send({ recipientName: "Rejecting Receiver", evidenceReference: "blob://pod/refund-1" })
      .expect(200);
    const rejectedDelivery = await request(app.getHttpServer())
      .post(`/v1/deliveries/${refundDelivery.body.data.id as string}/decision`)
      .set(buyer)
      .set("If-Match", refundPod.body.data.etag as string)
      .send({
        acceptedQuantity: { value: 0, scale: 1, unitCode: "KG" },
        rejectedQuantity: { value: 1_000, scale: 1, unitCode: "KG" },
        rejectionReason: "Temperature exceeded contract limit",
      })
      .expect(200);
    expect(rejectedDelivery.body.data.status).toBe("rejected");
    const refundPending = await request(app.getHttpServer())
      .get(`/v1/settlements/${refundSettlementId}`)
      .set(buyer)
      .expect(200);
    const refundedEvent = {
      eventId: `refunded-${refundSettlementId}`,
      settlementId: refundSettlementId,
      type: "REFUNDED",
      providerReference: refundSettlement.body.data.providerReference,
      occurredAt: new Date(Date.now() + 3).toISOString(),
    };
    const refunded = await request(app.getHttpServer())
      .post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", signProviderEvent(refundedEvent))
      .send(refundedEvent)
      .expect(200);
    expect(refundPending.body.data.settlement.status).toBe("refundPending");
    expect(refunded.body.data.status).toBe("refunded");

    const logisticsAlerts = await request(app.getHttpServer())
      .get(`/v1/risk/organizations/${logisticsOrganizationId}/alerts`)
      .set(logistics)
      .expect(200);
    expect(
      logisticsAlerts.body.data.some(
        (alert: { type: string }) => alert.type === "CONDITION_BREACH",
      ),
    ).toBe(true);

    const refundedView = await request(app.getHttpServer())
      .get(`/v1/settlements/${refundSettlementId}`)
      .set(buyer)
      .expect(200);
    const refundJournals = new Map<string, { debit: number; credit: number }>();
    for (const entry of refundedView.body.data.ledger as Array<{
      journalId: string;
      side: "debit" | "credit";
      amountMinor: number;
    }>) {
      const totals = refundJournals.get(entry.journalId) ?? { debit: 0, credit: 0 };
      totals[entry.side] += entry.amountMinor;
      refundJournals.set(entry.journalId, totals);
    }
    expect(
      [...refundJournals.values()].every(
        (value) => value.debit === value.credit,
      ),
    ).toBe(true);

    const holdLot = await createAvailableLot();
    const holdRfq = await request(app.getHttpServer()).post("/v1/trading/rfqs").set(seller)
      .send({ lotId: holdLot.body.data.id, invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201);
    const holdQuote = await request(app.getHttpServer()).post(`/v1/trading/rfqs/${holdRfq.body.data.id as string}/quotes`)
      .set(buyer).send({ unitPriceMinor: 600 }).expect(201);
    const holdTrade = await request(app.getHttpServer()).post(`/v1/trading/rfqs/${holdRfq.body.data.id as string}/accept`)
      .set(seller).set("If-Match", holdRfq.body.data.etag as string)
      .send({ quoteId: holdQuote.body.data.id }).expect(200);
    const holdSettlement = await request(app.getHttpServer()).post("/v1/settlements").set(buyer)
      .send({ rfqId: holdRfq.body.data.id, tradeId: holdTrade.body.data.trade.id }).expect(201);
    const holdFunding = { eventId: `funded-${holdSettlement.body.data.id as string}`,
      settlementId: holdSettlement.body.data.id as string, type: "FUNDED",
      providerReference: holdSettlement.body.data.providerReference,
      occurredAt: new Date(Date.now() + 4).toISOString() };
    await request(app.getHttpServer()).post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", signProviderEvent(holdFunding)).send(holdFunding).expect(200);
    const holdDelivery = await request(app.getHttpServer()).post("/v1/deliveries").set(seller)
      .send({ rfqId: holdRfq.body.data.id, tradeId: holdTrade.body.data.trade.id,
        logisticsOrganizationId, assignedLogisticsUserId: "delivery-driver-1" }).expect(201);
    let holdState = holdDelivery;
    for (const milestone of ["pickedUp", "inTransit", "arrived"] as const) {
      holdState = await request(app.getHttpServer()).post(`/v1/deliveries/${holdDelivery.body.data.id as string}/milestones/${milestone}`)
        .set(logistics).set("If-Match", holdState.body.data.etag as string).send({ oxygenMilliPercent: 98_000 }).expect(200);
    }
    const holdPod = await request(app.getHttpServer()).post(`/v1/deliveries/${holdDelivery.body.data.id as string}/pod`)
      .set(logistics).set("If-Match", holdState.body.data.etag as string)
      .send({ recipientName: "Partial Receiver", evidenceReference: "blob://pod/partial-1" }).expect(200);
    const partial = await request(app.getHttpServer()).post(`/v1/deliveries/${holdDelivery.body.data.id as string}/decision`)
      .set(buyer).set("If-Match", holdPod.body.data.etag as string)
      .send({ acceptedQuantity: { value: 700, scale: 1, unitCode: "KG" },
        rejectedQuantity: { value: 300, scale: 1, unitCode: "KG" },
        rejectionReason: "Partial quality rejection" }).expect(200);
    expect(partial.body.data.status).toBe("partiallyAccepted");
    expect(partial.body.data.settlementAction).toBe("hold");
    const heldSettlementView = await request(app.getHttpServer()).get(`/v1/settlements/${holdSettlement.body.data.id as string}`)
      .set(buyer).expect(200);
    expect(heldSettlementView.body.data.settlement.status).toBe("deliveryHold");

    const dispute = await request(app.getHttpServer())
      .post("/v1/disputes")
      .set(buyer)
      .send({
        deliveryId: holdDelivery.body.data.id,
        reasonCode: "PARTIAL_QUALITY_REJECTION",
        description: "Buyer disputes the rejected portion after POD review",
        evidenceReferences: ["blob://disputes/buyer-quality-photo-1"],
      })
      .expect(201);
    const disputeId = dispute.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/v1/disputes/${disputeId}/evidence`)
      .set(buyer)
      .send({
        evidenceReference: "blob://disputes/buyer-temperature-log-1",
        description: "Temperature logger export",
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/disputes/${disputeId}/responses`)
      .set(seller)
      .send({
        message: "Seller accepts release for the accepted portion pending operator decision",
        evidenceReferences: ["blob://disputes/seller-dispatch-record-1"],
      })
      .expect(201);

    const mediation = await request(app.getHttpServer())
      .post(`/v1/disputes/${disputeId}/start-mediation`)
      .set("x-user-id", "dispute-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .set("If-Match", dispute.body.data.etag as string)
      .expect(200);
    expect(mediation.body.data.status).toBe("mediation");
    await request(app.getHttpServer())
      .post(`/v1/disputes/${disputeId}/decide`)
      .set(buyer)
      .set("If-Match", mediation.body.data.etag as string)
      .send({ remedy: "release", rationale: "Buyer cannot self-decide" })
      .expect(403);

    const resolvedDispute = await request(app.getHttpServer())
      .post(`/v1/disputes/${disputeId}/decide`)
      .set("x-user-id", "dispute-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .set("If-Match", mediation.body.data.etag as string)
      .send({
        remedy: "release",
        rationale: "Evidence supports releasing escrow under the pilot rulebook",
      })
      .expect(200);
    expect(resolvedDispute.body.data.status).toBe("resolved");
    expect(resolvedDispute.body.data.remedy).toBe("release");
    await request(app.getHttpServer())
      .post(`/v1/disputes/${disputeId}/evidence`)
      .set(buyer)
      .send({
        evidenceReference: "blob://disputes/late-evidence",
        description: "Late evidence",
      })
      .expect(400);

    const regulatorDisputeView = await request(app.getHttpServer())
      .get(`/v1/disputes/${disputeId}`)
      .set("x-user-id", "dispute-regulator-1")
      .set("x-personas", "Regulator")
      .expect(200);
    expect(regulatorDisputeView.body.data.evidence).toHaveLength(2);
    expect(regulatorDisputeView.body.data.responses).toHaveLength(1);

    const disputeSettlement = await request(app.getHttpServer())
      .get(`/v1/settlements/${holdSettlement.body.data.id as string}`)
      .set(buyer)
      .expect(200);
    expect(disputeSettlement.body.data.settlement.status).toBe("releasePending");
    const disputeReleaseEvent = {
      eventId: `released-dispute-${holdSettlement.body.data.id as string}`,
      settlementId: holdSettlement.body.data.id as string,
      type: "RELEASED",
      providerReference: holdSettlement.body.data.providerReference,
      occurredAt: new Date(Date.now() + 5).toISOString(),
    };
    const disputeReleased = await request(app.getHttpServer())
      .post("/v1/settlements/provider-events/callback")
      .set("x-escrow-signature", signProviderEvent(disputeReleaseEvent))
      .send(disputeReleaseEvent)
      .expect(200);
    expect(disputeReleased.body.data.status).toBe("released");

    const soldLot = await request(app.getHttpServer()).get(`/v1/inventory/lots/${available.body.data.id as string}`)
      .set(seller).expect(200);
    expect(soldLot.body.data.status).toBe("sold");
    await request(app.getHttpServer()).post("/v1/trading/rfqs").set(seller)
      .send({ lotId: available.body.data.id, invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400);

    const cancelLot = await createAvailableLot();
    const cancellable = await request(app.getHttpServer()).post("/v1/trading/rfqs")
      .set(seller).send({ lotId: cancelLot.body.data.id,
        invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201);
    await request(app.getHttpServer()).post(`/v1/trading/rfqs/${cancellable.body.data.id as string}/cancel`)
      .set(seller).set("If-Match", cancellable.body.data.etag as string)
      .send({ reason: "Supply withdrawn before quote acceptance" }).expect(200);
    expect((await request(app.getHttpServer()).get(`/v1/inventory/lots/${cancelLot.body.data.id as string}`)
      .set(seller).expect(200)).body.data.status).toBe("available");
  });

  it("manages compliance expiry, lineage, recalls, and movement restrictions", async () => {
    const farmerIdentity = {
      "x-user-id": "compliance-farmer-1",
      "x-personas": "Farmer",
    };
    const organization = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set(farmerIdentity)
      .send({ name: "Ferme Traçable", type: "farmer" })
      .expect(201);
    const organizationId = organization.body.data.id as string;
    const farmer = {
      ...farmerIdentity,
      "x-organization-id": organizationId,
    };
    const buyerIdentity = {
      "x-user-id": "compliance-buyer-1",
      "x-personas": "Buyer",
    };
    const buyerOrganization = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set(buyerIdentity)
      .send({ name: "Acheteur Traçable", type: "buyer" })
      .expect(201);
    const buyerOrganizationId = buyerOrganization.body.data.id as string;

    const document = await request(app.getHttpServer())
      .post("/v1/compliance/documents")
      .set(farmer)
      .send({
        organizationId,
        type: "SANITARY_LICENSE",
        documentReference: "SAN-EXP-001",
        evidenceReference: "blob://compliance/sanitary-license-1",
        issuedAt: "2025-01-01T00:00:00.000Z",
        validUntil: "2026-01-01T00:00:00.000Z",
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/v1/compliance/organizations/${organizationId}/documents/${document.body.data.id as string}/review`,
      )
      .set(farmer)
      .set("If-Match", document.body.data.etag as string)
      .send({ status: "approved", reason: "Owner cannot approve" })
      .expect(403);
    await request(app.getHttpServer())
      .post(
        `/v1/compliance/organizations/${organizationId}/documents/${document.body.data.id as string}/review`,
      )
      .set("x-user-id", "compliance-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .set("If-Match", document.body.data.etag as string)
      .send({ status: "approved", reason: "Historical license verified" })
      .expect(200);
    const documents = await request(app.getHttpServer())
      .get(`/v1/compliance/organizations/${organizationId}/documents`)
      .set(farmer)
      .expect(200);
    expect(documents.body.data[0].effectiveStatus).toBe("expired");
    const expiryAlerts = await request(app.getHttpServer())
      .post(`/v1/risk/organizations/${organizationId}/scan-compliance`)
      .set("x-user-id", "compliance-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .send({ warningDays: 30 })
      .expect(201);
    expect(expiryAlerts.body.data[0].type).toBe("COMPLIANCE_EXPIRY");

    const createLot = async (value: number) =>
      request(app.getHttpServer())
        .post("/v1/inventory/lots")
        .set(farmer)
        .send({
          ownerOrganizationId: organizationId,
          category: "crop",
          commodityCode: "TOMATO",
          originRegionCode: "ABIDJAN",
          quantity: { value, scale: 1, unitCode: "KG" },
        })
        .expect(201);
    const parent = await createLot(1_000);
    const child = await createLot(600);
    const grandchild = await createLot(500);
    const availableParent = await request(app.getHttpServer())
      .post(`/v1/inventory/lots/${parent.body.data.id as string}/mark-available`)
      .set(farmer)
      .set("If-Match", parent.body.data.etag as string)
      .expect(200);

    await request(app.getHttpServer())
      .post("/v1/traceability/lineage")
      .set(farmer)
      .send({
        parentLotIds: [parent.body.data.id],
        childLotId: child.body.data.id,
        transformationType: "split",
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/traceability/lineage")
      .set(farmer)
      .send({
        parentLotIds: [child.body.data.id],
        childLotId: grandchild.body.data.id,
        transformationType: "repack",
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/traceability/lineage")
      .set(farmer)
      .send({
        parentLotIds: [grandchild.body.data.id],
        childLotId: parent.body.data.id,
        transformationType: "invalid-cycle",
      })
      .expect(400);
    const trace = await request(app.getHttpServer())
      .get(`/v1/traceability/lots/${parent.body.data.id as string}`)
      .set("x-user-id", "trace-regulator-1")
      .set("x-personas", "Regulator")
      .expect(200);
    expect(trace.body.data.descendantLotIds).toHaveLength(2);
    expect(trace.body.data.edges).toHaveLength(2);

    const recalled = await request(app.getHttpServer())
      .post("/v1/compliance/recalls")
      .set("x-user-id", "trace-regulator-1")
      .set("x-personas", "Regulator")
      .send({
        reference: `RECALL-TOMATO-${organizationId}`,
        rootLotId: parent.body.data.id,
        reason: "Suspected contaminated input",
      })
      .expect(201);
    expect(recalled.body.data.impacts).toHaveLength(3);
    for (const lotId of [parent.body.data.id, child.body.data.id, grandchild.body.data.id]) {
      const held = await request(app.getHttpServer())
        .get(`/v1/inventory/lots/${lotId as string}`)
        .set(farmer)
        .expect(200);
      expect(held.body.data.status).toBe("quarantined");
    }
    const releasedRecall = await request(app.getHttpServer())
      .post(`/v1/compliance/recalls/${recalled.body.data.recall.id as string}/release`)
      .set("x-user-id", "trace-regulator-1")
      .set("x-personas", "Regulator")
      .set("If-Match", recalled.body.data.recall.etag as string)
      .expect(200);
    expect(releasedRecall.body.data.recall.status).toBe("released");
    expect(
      (
        await request(app.getHttpServer())
          .get(`/v1/inventory/lots/${parent.body.data.id as string}`)
          .set(farmer)
          .expect(200)
      ).body.data.status,
    ).toBe("available");

    const restriction = await request(app.getHttpServer())
      .post("/v1/compliance/movement-restrictions")
      .set("x-user-id", "trace-regulator-1")
      .set("x-personas", "Regulator")
      .send({
        reference: `MOVE-ABJ-TOMATO-001-${organizationId}`,
        regionCode: "ABIDJAN",
        commodityCode: "TOMATO",
        reason: "Temporary phytosanitary movement restriction",
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/trading/rfqs")
      .set(farmer)
      .send({
        lotId: availableParent.body.data.id,
        invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(
        `/v1/compliance/movement-restrictions/ABIDJAN/${restriction.body.data.id as string}/release`,
      )
      .set("x-user-id", "trace-regulator-1")
      .set("x-personas", "Regulator")
      .set("If-Match", restriction.body.data.etag as string)
      .expect(200);
    const unrestrictedRfq = await request(app.getHttpServer())
      .post("/v1/trading/rfqs")
      .set(farmer)
      .send({
        lotId: availableParent.body.data.id,
        invitedBuyerOrganizationIds: [buyerOrganizationId],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(201);
    const buyer = {
      ...buyerIdentity,
      "x-organization-id": buyerOrganizationId,
    };
    const unrestrictedQuote = await request(app.getHttpServer())
      .post(
        `/v1/trading/rfqs/${unrestrictedRfq.body.data.id as string}/quotes`,
      )
      .set(buyer)
      .send({ unitPriceMinor: 750 })
      .expect(201);
    const lateRestriction = await request(app.getHttpServer())
      .post("/v1/compliance/movement-restrictions")
      .set("x-user-id", "trace-regulator-1")
      .set("x-personas", "Regulator")
      .send({
        reference: `MOVE-ABJ-TOMATO-002-${organizationId}`,
        regionCode: "ABIDJAN",
        commodityCode: "TOMATO",
        reason: "Restriction introduced after RFQ publication",
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${unrestrictedRfq.body.data.id as string}/accept`)
      .set(farmer)
      .set("If-Match", unrestrictedRfq.body.data.etag as string)
      .send({ quoteId: unrestrictedQuote.body.data.id })
      .expect(400);
    await request(app.getHttpServer())
      .post(
        `/v1/compliance/movement-restrictions/ABIDJAN/${lateRestriction.body.data.id as string}/release`,
      )
      .set("x-user-id", "trace-regulator-1")
      .set("x-personas", "Regulator")
      .set("If-Match", lateRestriction.body.data.etag as string)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/trading/rfqs/${unrestrictedRfq.body.data.id as string}/accept`)
      .set(farmer)
      .set("If-Match", unrestrictedRfq.body.data.etag as string)
      .send({ quoteId: unrestrictedQuote.body.data.id })
      .expect(200);
  });

  it("publishes public events and exposes scoped reports and audit history", async () => {
    const consumer = {
      "x-user-id": "public-data-consumer-1",
      "x-personas": "DataConsumer",
    };
    await request(app.getHttpServer())
      .post("/v1/integrations/webhooks")
      .set(consumer)
      .send({
        endpoint: "https://172.20.0.10/events",
        topics: ["public.market.snapshot"],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post("/v1/integrations/webhooks")
      .set(consumer)
      .send({
        endpoint: "https://hooks.example.invalid/bordchamp/public",
        topics: ["public.market.snapshot"],
      })
      .expect(201);
    const sequenceFloor = String(Date.now() - 1_000).padStart(13, "0");
    const published = await request(app.getHttpServer())
      .post("/v1/integrations/events")
      .set("x-user-id", "integration-admin-1")
      .set("x-personas", "ExchangeAdmin")
      .send({
        topic: "public.market.snapshot",
        subjectId: "XOF-TOMATO-SPOT",
        payload: {
          commodityCode: "TOMATO",
          marketState: "open",
          delayed: true,
        },
      })
      .expect(201);
    const publicFeed = await request(app.getHttpServer())
      .get(`/v1/integrations/events/public?limit=10&after=${sequenceFloor}`)
      .expect(200);
    expect(publicFeed.body.public).toBe(true);
    expect(
      publicFeed.body.data.some(
        (event: { id: string }) => event.id === published.body.data.id,
      ),
    ).toBe(true);

    const organizations = await request(app.getHttpServer())
      .post("/v1/organizations")
      .set("x-user-id", "report-buyer-1")
      .set("x-personas", "Buyer")
      .send({ name: "Reporting Buyer", type: "buyer" })
      .expect(201);
    const organizationId = organizations.body.data.id as string;
    const reportingBuyer = {
      "x-user-id": "report-buyer-1",
      "x-personas": "Buyer",
      "x-organization-id": organizationId,
    };
    const report = await request(app.getHttpServer())
      .get(`/v1/reports/organizations/${organizationId}/summary`)
      .set(reportingBuyer)
      .expect(200);
    expect(report.body.data.organizationId).toBe(organizationId);
    expect(report.body.data.currencyCode).toBe("XOF");

    const ownAudit = await request(app.getHttpServer())
      .get(`/v1/audit/events?organizationId=${organizationId}&limit=20`)
      .set(reportingBuyer)
      .expect(200);
    if (process.env.AZURE_STORAGE_CONNECTION_STRING !== undefined) {
      expect(
        ownAudit.body.data.some(
          (event: { module: string }) => event.module === "organizations",
        ),
      ).toBe(true);
    }
    const globalAudit = await request(app.getHttpServer())
      .get("/v1/audit/events?limit=20")
      .set("x-user-id", "audit-regulator-1")
      .set("x-personas", "Regulator")
      .expect(200);
    if (process.env.AZURE_STORAGE_CONNECTION_STRING !== undefined) {
      expect(globalAudit.body.data.length).toBeGreaterThan(0);
    }

    const publicSummary = await request(app.getHttpServer())
      .get("/v1/public/reports/market-summary")
      .expect(200);
    expect(publicSummary.body.data.public).toBe(true);
    expect(publicSummary.body.data.currencyCode).toBe("XOF");
  });
});