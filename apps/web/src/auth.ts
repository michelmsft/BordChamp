// BordChamp-managed auth client. Access tokens live only in memory; refresh cookie is HttpOnly.

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

export interface Profile {
  id: string
  email: string
  displayName?: string
  givenName?: string
  surname?: string
  locale: string
  status: 'active' | 'suspended' | 'inactive'
  onboardingState: 'pendingMfa' | 'profileRequired' | 'organizationRequired' | 'complete'
  sessionVersion: number
  preferredOrganizationId?: string
  createdAt: string
  updatedAt: string
  etag: string
}

export interface Membership {
  userId: string
  organizationId: string
  role: 'owner' | 'admin' | 'member'
  personas: Persona[]
  status: 'active' | 'suspended' | 'revoked'
  joinedAt: string
  etag: string
}

export interface Session {
  profile: Profile
  memberships: Membership[]
  activeOrganizationId?: string
  activeMembership?: Membership
  effectivePersonas: Persona[]
  organizations?: Record<string, { id: string; name: string; type: string }>
}

export interface RegisterEnrollment {
  enrollmentToken: string
  otpauthUri: string
  secretBase32: string
}

export interface AuthenticationResponse {
  accessToken: string
  profile: Profile
}

export interface RegistrationVerification extends AuthenticationResponse {
  recoveryCodes: string[]
}

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(value: string | null): void {
  accessToken = value
}

export function clearAccessToken(): void {
  accessToken = null
}

async function authFetch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const parsed = (await response.json().catch(() => null)) as { data?: T; message?: string | string[] } | null
  if (!response.ok) {
    const message = parsed?.message
    throw new Error(Array.isArray(message) ? message.join(', ') : message ?? `Erreur HTTP ${response.status}`)
  }
  return parsed?.data as T
}

export async function register(email: string, password: string): Promise<RegisterEnrollment> {
  return authFetch<RegisterEnrollment>('/v1/auth/register', { email, password })
}

export async function verifyRegistration(enrollmentToken: string, code: string): Promise<RegistrationVerification> {
  const result = await authFetch<RegistrationVerification>('/v1/auth/register/verify', { enrollmentToken, code })
  setAccessToken(result.accessToken)
  return result
}

export async function login(email: string, password: string): Promise<{ challengeToken: string }> {
  return authFetch<{ challengeToken: string }>('/v1/auth/login', { email, password })
}

export async function verifyLogin(challengeToken: string, code: string, useRecovery = false): Promise<AuthenticationResponse> {
  const result = await authFetch<AuthenticationResponse>('/v1/auth/login/verify', { challengeToken, code, useRecovery })
  setAccessToken(result.accessToken)
  return result
}

export async function refresh(): Promise<AuthenticationResponse | null> {
  try {
    const result = await authFetch<AuthenticationResponse>('/v1/auth/refresh', {})
    setAccessToken(result.accessToken)
    return result
  } catch {
    clearAccessToken()
    return null
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
  } finally {
    clearAccessToken()
  }
}
