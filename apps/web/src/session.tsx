import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  clearAccessToken,
  getAccessToken,
  login as apiLogin,
  logout as apiLogout,
  refresh as apiRefresh,
  register as apiRegister,
  setAccessToken,
  verifyLogin as apiVerifyLogin,
  verifyRegistration as apiVerifyRegistration,
  type AuthenticationResponse,
  type Persona,
  type Profile,
  type RegisterEnrollment,
  type RegistrationVerification,
  type Session,
} from './auth'

type Status = 'loading' | 'unauthenticated' | 'registerVerify' | 'mfaChallenge' | 'authenticated'

interface RegisterState {
  email: string
  enrollment: RegisterEnrollment
}

interface MfaState {
  email: string
  challengeToken: string
}

interface SessionContextValue {
  status: Status
  session: Session | null
  register: (email: string, password: string) => Promise<RegisterEnrollment>
  verifyRegistration: (code: string) => Promise<RegistrationVerification>
  login: (email: string, password: string) => Promise<void>
  verifyMfa: (code: string, useRecovery: boolean) => Promise<AuthenticationResponse>
  cancelRegistration: () => void
  cancelMfa: () => void
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  selectOrganization: (organizationId: string) => Promise<void>
  registerState: RegisterState | null
  mfaState: MfaState | null
  lastRecoveryCodes: string[] | null
  acknowledgeRecoveryCodes: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const attempt = async (): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set('accept', 'application/json')
    const token = getAccessToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
    return fetch(`/api${path}`, { ...init, headers, credentials: 'include' })
  }
  let response = await attempt()
  if (response.status === 401) {
    const refreshed = await apiRefresh()
    if (refreshed) response = await attempt()
  }
  const parsed = (await response.json().catch(() => null)) as { data?: T; message?: string | string[] } | null
  if (!response.ok) {
    const message = parsed?.message
    throw new Error(Array.isArray(message) ? message.join(', ') : message ?? `Erreur HTTP ${response.status}`)
  }
  return parsed?.data as T
}

async function loadSession(): Promise<Session | null> {
  if (!getAccessToken()) return null
  return apiCall<Session>('/v1/me')
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [registerState, setRegisterState] = useState<RegisterState | null>(null)
  const [mfaState, setMfaState] = useState<MfaState | null>(null)
  const [lastRecoveryCodes, setLastRecoveryCodes] = useState<string[] | null>(null)
  const bootstrapped = useRef(false)

  const refreshSession = useCallback(async () => {
    const value = await loadSession()
    setSession(value)
    setStatus(value ? 'authenticated' : 'unauthenticated')
  }, [])

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    ;(async () => {
      const refreshed = await apiRefresh()
      if (!refreshed) {
        setStatus('unauthenticated')
        return
      }
      try {
        const value = await apiCall<Session>('/v1/me')
        setSession(value)
        setStatus('authenticated')
      } catch {
        clearAccessToken()
        setStatus('unauthenticated')
      }
    })().catch(() => setStatus('unauthenticated'))
  }, [])

  const value = useMemo<SessionContextValue>(() => ({
    status,
    session,
    registerState,
    mfaState,
    lastRecoveryCodes,
    async register(email, password) {
      const enrollment = await apiRegister(email, password)
      setRegisterState({ email, enrollment })
      setStatus('registerVerify')
      return enrollment
    },
    async verifyRegistration(code) {
      if (!registerState) throw new Error("Aucune inscription en cours.")
      const result = await apiVerifyRegistration(registerState.enrollment.enrollmentToken, code)
      setLastRecoveryCodes(result.recoveryCodes)
      const nextSession = await apiCall<Session>('/v1/me')
      setSession(nextSession)
      setStatus('authenticated')
      setRegisterState(null)
      return result
    },
    async login(email, password) {
      const { challengeToken } = await apiLogin(email, password)
      setMfaState({ email, challengeToken })
      setStatus('mfaChallenge')
    },
    async verifyMfa(code, useRecovery) {
      if (!mfaState) throw new Error("Aucune connexion en cours.")
      const result = await apiVerifyLogin(mfaState.challengeToken, code, useRecovery)
      const nextSession = await apiCall<Session>('/v1/me')
      setSession(nextSession)
      setStatus('authenticated')
      setMfaState(null)
      return result
    },
    cancelRegistration() {
      setRegisterState(null)
      setStatus('unauthenticated')
    },
    cancelMfa() {
      setMfaState(null)
      setStatus('unauthenticated')
    },
    async logout() {
      await apiLogout()
      setSession(null)
      setStatus('unauthenticated')
      setLastRecoveryCodes(null)
    },
    async refreshSession() {
      await refreshSession()
    },
    async selectOrganization(organizationId) {
      if (!session) return
      await apiCall<Profile>('/v1/me/active-organization', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': session.profile.etag },
        body: JSON.stringify({ organizationId }),
      })
      await refreshSession()
    },
    acknowledgeRecoveryCodes() {
      setLastRecoveryCodes(null)
    },
  }), [status, session, registerState, mfaState, lastRecoveryCodes, refreshSession])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used within SessionProvider')
  return context
}

export function usePersona(): Persona | null {
  const { session } = useSession()
  return session?.effectivePersonas[0] ?? null
}

export { setAccessToken, clearAccessToken, getAccessToken }
