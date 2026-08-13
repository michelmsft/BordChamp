import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { HealthController } from "./health/health.controller.js";
import { RequestActorService } from "./identity/request-actor.service.js";
import { AuthenticationGuard } from "./identity/authentication.guard.js";
import { IdentityController } from "./identity/identity.controller.js";
import {
  createIdentityRepository,
  IDENTITY_REPOSITORY,
} from "./identity/identity.repository.js";
import { IdentityService } from "./identity/identity.service.js";
import { AuthService } from "./identity/auth.service.js";
import { AdminBootstrapService } from "./identity/admin-bootstrap.service.js";
import {
  createTokenSigner,
  TOKEN_SIGNER,
} from "./identity/token-signer.js";
import {
  createInspectionRepository,
  INSPECTION_REPOSITORY,
} from "./inspections/inspection.repository.js";
import { InspectionsController } from "./inspections/inspections.controller.js";
import { InspectionsService } from "./inspections/inspections.service.js";
import {
  createInventoryRepository,
  INVENTORY_REPOSITORY,
} from "./inventory/inventory.repository.js";
import { InventoryController } from "./inventory/inventory.controller.js";
import { InventoryService } from "./inventory/inventory.service.js";
import {
  createOrganizationRepository,
  ORGANIZATION_REPOSITORY,
} from "./organizations/organization.repository.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { OrganizationsService } from "./organizations/organizations.service.js";
import {
  createProductionUnitRepository,
  PRODUCTION_UNIT_REPOSITORY,
} from "./production-units/production-unit.repository.js";
import { ProductionUnitsController } from "./production-units/production-units.controller.js";
import { ProductionUnitsService } from "./production-units/production-units.service.js";
import { ReferenceDataController } from "./reference-data/reference-data.controller.js";
import { ReferenceDataAdminController } from "./reference-data/reference-data-admin.controller.js";
import {
  COMMODITY_REPOSITORY,
  createCommodityRepository,
} from "./reference-data/commodity.repository.js";
import {
  createUnitRepository,
  UNIT_REPOSITORY,
} from "./reference-data/unit.repository.js";
import {
  createInspectionSchemeRepository,
  INSPECTION_SCHEME_REPOSITORY,
} from "./reference-data/inspection-scheme.repository.js";
import { ReferenceDataService } from "./reference-data/reference-data.service.js";
import {
  createWarehouseReceiptRepository,
  WAREHOUSE_RECEIPT_REPOSITORY,
} from "./warehousing/warehouse-receipt.repository.js";
import { WarehousingController } from "./warehousing/warehousing.controller.js";
import { WarehousingService } from "./warehousing/warehousing.service.js";
import {
  createTradingRepository,
  TRADING_REPOSITORY,
} from "./trading/trading.repository.js";
import { TradingController } from "./trading/trading.controller.js";
import { TradingService } from "./trading/trading.service.js";
import {
  createSettlementRepository,
  SETTLEMENT_REPOSITORY,
} from "./settlement/settlement.repository.js";
import { SettlementController } from "./settlement/settlement.controller.js";
import { SettlementService } from "./settlement/settlement.service.js";
import {
  createDeliveryRepository,
  DELIVERY_REPOSITORY,
} from "./delivery/delivery.repository.js";
import { DeliveryController } from "./delivery/delivery.controller.js";
import { DeliveryService } from "./delivery/delivery.service.js";
import {
  createDisputeRepository,
  DISPUTE_REPOSITORY,
} from "./disputes/dispute.repository.js";
import { DisputesController } from "./disputes/disputes.controller.js";
import { DisputesService } from "./disputes/disputes.service.js";
import {
  COMPLIANCE_REPOSITORY,
  createComplianceRepository,
} from "./compliance/compliance.repository.js";
import { ComplianceController } from "./compliance/compliance.controller.js";
import { ComplianceService } from "./compliance/compliance.service.js";
import {
  createRiskRepository,
  RISK_REPOSITORY,
} from "./risk/risk.repository.js";
import { RiskController } from "./risk/risk.controller.js";
import { RiskService } from "./risk/risk.service.js";
import {
  createIntegrationRepository,
  INTEGRATION_REPOSITORY,
} from "./integrations/integration.repository.js";
import { IntegrationsController } from "./integrations/integrations.controller.js";
import { IntegrationsService } from "./integrations/integrations.service.js";
import { ReadModelsController } from "./read-models/read-models.controller.js";
import { ReadModelsService } from "./read-models/read-models.service.js";

@Module({
  controllers: [
    HealthController,
    IdentityController,
    InspectionsController,
    InventoryController,
    OrganizationsController,
    ProductionUnitsController,
    ReferenceDataController,
    ReferenceDataAdminController,
    WarehousingController,
    TradingController,
    SettlementController,
    DeliveryController,
    DisputesController,
    ComplianceController,
    RiskController,
    IntegrationsController,
    ReadModelsController,
  ],
  providers: [
    {
      provide: COMMODITY_REPOSITORY,
      useFactory: createCommodityRepository,
    },
    {
      provide: UNIT_REPOSITORY,
      useFactory: createUnitRepository,
    },
    {
      provide: INSPECTION_SCHEME_REPOSITORY,
      useFactory: createInspectionSchemeRepository,
    },
    {
      provide: ORGANIZATION_REPOSITORY,
      useFactory: createOrganizationRepository,
    },
    {
      provide: INVENTORY_REPOSITORY,
      useFactory: createInventoryRepository,
    },
    {
      provide: INSPECTION_REPOSITORY,
      useFactory: createInspectionRepository,
    },
    InspectionsService,
    {
      provide: PRODUCTION_UNIT_REPOSITORY,
      useFactory: createProductionUnitRepository,
    },
    InventoryService,
    ProductionUnitsService,
    RequestActorService,
    IdentityService,
    AuthService,
    AdminBootstrapService,
    {
      provide: IDENTITY_REPOSITORY,
      useFactory: createIdentityRepository,
    },
    {
      provide: TOKEN_SIGNER,
      useFactory: createTokenSigner,
    },
    {
      provide: APP_GUARD,
      useClass: AuthenticationGuard,
    },
    OrganizationsService,
    ReferenceDataService,
    {
      provide: WAREHOUSE_RECEIPT_REPOSITORY,
      useFactory: createWarehouseReceiptRepository,
    },
    WarehousingService,
    {
      provide: TRADING_REPOSITORY,
      useFactory: createTradingRepository,
    },
    TradingService,
    {
      provide: SETTLEMENT_REPOSITORY,
      useFactory: createSettlementRepository,
    },
    SettlementService,
    {
      provide: DELIVERY_REPOSITORY,
      useFactory: createDeliveryRepository,
    },
    DeliveryService,
    {
      provide: DISPUTE_REPOSITORY,
      useFactory: createDisputeRepository,
    },
    DisputesService,
    {
      provide: COMPLIANCE_REPOSITORY,
      useFactory: createComplianceRepository,
    },
    ComplianceService,
    {
      provide: RISK_REPOSITORY,
      useFactory: createRiskRepository,
    },
    RiskService,
    {
      provide: INTEGRATION_REPOSITORY,
      useFactory: createIntegrationRepository,
    },
    IntegrationsService,
    ReadModelsService,
  ],
})
export class AppModule {}