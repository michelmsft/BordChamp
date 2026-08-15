export type Persona =
  | 'Farmer'
  | 'CooperativeManager'
  | 'Trader'
  | 'Broker'
  | 'Buyer'
  | 'WarehouseOperator'
  | 'LogisticsProvider'
  | 'Inspector'
  | 'ExchangeAdmin'
  | 'Regulator'
  | 'DataConsumer'

export interface Identity {
  userId: string
  persona: Persona
  organizationId: string
}

export interface Market {
  commodityCode: string
  tradeCount: number
  volume: number
  scale: number
  unitCode: string
  grossAmountMinor: number
}

export interface MarketSummary {
  generatedAt: string
  currencyCode: string
  markets: Market[]
}

export interface Commodity {
  code: string
  name: {
    en: string
    fr: string
  }
  category: string
  iconName?: string
  imageName?: string
  public: true
}

export type CommodityCategory = 'crop' | 'aquaculture' | 'liveAnimal' | 'animalProduct'
export type CommodityStatus = 'active' | 'suspended' | 'inactive'

export interface AdminCommodity {
  code: string
  category: CommodityCategory
  name: { en: string; fr: string }
  iconName?: string
  imageName?: string
  defaultUnitCode?: string
  allowedUnitCodes: string[]
  isPublic: boolean
  status: CommodityStatus
  effectiveFrom: string
}

export type UnitDimension = 'mass' | 'count' | 'volume' | 'length' | 'temperature'
export type UnitStatus = 'active' | 'suspended' | 'inactive'

export interface Unit {
  code: string
  label: { en: string; fr: string }
  dimension: UnitDimension
  baseUnitCode?: string
  factorToBase?: number
  scale: number
  status: UnitStatus
}

export type InspectionType = 'quality' | 'sanitary' | 'veterinary' | 'aquacultureHealth' | 'coldChain'
export type MetricResultKind = 'percentage' | 'passFail' | 'measurement' | 'qualitative'
export type StandardOperator = 'gte' | 'lte' | 'range' | 'equals' | 'qualitative'
export type SchemeStatus = 'active' | 'suspended' | 'inactive'

export interface InspectionMetric {
  code: string
  label: { en: string; fr: string }
  whatIsChecked: { en: string; fr: string }
  resultKind: MetricResultKind
  standard: {
    operator: StandardOperator
    threshold?: number
    min?: number
    max?: number
    unitCode?: string
    text?: string
  }
  mandatory: boolean
  weight?: number
}

export interface InspectionGrade {
  code: string
  label: { en: string; fr: string }
  rank: number
  minScore?: number
  requiredPasses?: string[]
}

export interface InspectionScheme {
  commodityCode: string
  type: InspectionType
  label: { en: string; fr: string }
  samplingHint?: string
  metrics: InspectionMetric[]
  grades: InspectionGrade[]
  status: SchemeStatus
  updatedAt: string
}

export interface IntegrationEvent {
  id: string
  sequenceId: string
  topic: string
  subjectId: string
  occurredAt: string
  payload: Record<string, unknown>
}

export interface OrganizationSummary {
  organizationId: string
  generatedAt: string
  inventoryByStatus: Record<string, number>
  tradeCount: number
  grossSoldMinor: number
  grossBoughtMinor: number
  feeAmountMinor: number
  currencyCode: string
  settlementsByStatus: Record<string, number>
  deliveriesByStatus: Record<string, number>
  riskAlertsByStatus: Record<string, number>
}

interface Envelope<T> {
  data: T
}

import { expireSession, getAccessToken, refresh as refreshToken } from './auth'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, identity?: Identity, init?: RequestInit): Promise<T> {
  const attempt = async (): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set('accept', 'application/json')
    if (init?.body) headers.set('content-type', 'application/json')
    const token = getAccessToken()
    if (token) headers.set('x-bordchamp-authorization', `Bearer ${token}`)
    if (identity?.organizationId) headers.set('x-organization-id', identity.organizationId)
    if (identity?.persona) headers.set('x-personas', identity.persona)
    return fetch(`/api${path}`, { ...init, headers, credentials: 'include' })
  }
  let response = await attempt()
  if (response.status === 401) {
    const refreshed = await refreshToken()
    if (refreshed) response = await attempt()
    if (!refreshed || response.status === 401) expireSession()
  }
  const body = (await response.json().catch(() => null)) as Envelope<T> | { message?: string | string[] } | null
  if (!response.ok) {
    const message = body && 'message' in body ? body.message : undefined
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message ?? `Erreur HTTP ${response.status}`, response.status)
  }
  if (response.status === 204) return undefined as T
  return (body as Envelope<T>).data
}