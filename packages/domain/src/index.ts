export const PERSONAS = [
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
  "DataConsumer",
] as const;

export type Persona = (typeof PERSONAS)[number];

export const ENTITY_STATUSES = [
  "active",
  "windDown",
  "suspended",
  "inactive",
] as const;

export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export interface ActorContext {
  readonly userId: string;
  readonly organizationId?: string;
  readonly personas: readonly Persona[];
  readonly representedOrganizationIds: readonly string[];
  readonly assignmentIds: readonly string[];
}