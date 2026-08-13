import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import QRCode from 'qrcode'

import type { Identity } from './api'
import type { Persona } from './auth'
import { useSession } from './session'

const PERSONA_LABELS: Record<Persona, string> = {
  Farmer: 'Producteur',
  CooperativeManager: 'Coopérative',
  Trader: 'Négociant',
  Broker: 'Courtier',
  Buyer: 'Acheteur',
  WarehouseOperator: 'Entrepôt',
  LogisticsProvider: 'Logistique',
  Inspector: 'Inspecteur',
  ExchangeAdmin: 'Admin place de marché',
  Regulator: 'Régulateur',
  DataConsumer: 'Analyste',
}

export function personaLabel(persona: Persona | string | undefined | null): string {
  if (!persona) return 'Utilisateur'
  return (PERSONA_LABELS as Record<string, string>)[persona] ?? persona
}

type BoundaryProps = { children: (identity: Identity) => ReactNode }

export function AuthenticationBoundary({ children }: BoundaryProps) {
  const { status, session, lastRecoveryCodes, acknowledgeRecoveryCodes } = useSession()
  if (status === 'loading') return <SplashScreen message="Chargement de la session..." />
  if (status === 'registerVerify') return <RegisterVerifyScreen />
  if (status === 'mfaChallenge') return <MfaChallengeScreen />
  if (status === 'unauthenticated' || !session) return <UnauthenticatedScreen />
  if (session.profile.status !== 'active') return <SplashScreen message="Compte suspendu. Contactez l'administrateur." />
  if (session.profile.onboardingState === 'profileRequired') return <OnboardingProfileScreen />
  if (session.profile.onboardingState === 'organizationRequired') return <OnboardingOrganizationScreen />
  if (lastRecoveryCodes) return <RecoveryCodesScreen codes={lastRecoveryCodes} onDone={acknowledgeRecoveryCodes} />
  const persona = session.effectivePersonas[0]
  if (!session.activeOrganizationId || !persona) return <OnboardingOrganizationScreen />
  const identity: Identity = {
    userId: session.profile.id,
    persona,
    organizationId: session.activeOrganizationId,
  }
  return <>{children(identity)}</>
}

function SplashScreen({ message }: { message: string }) {
  return (
    <div className="auth-splash">
      <div className="auth-card">
        <h1>BordChamp</h1>
        <p>{message}</p>
      </div>
    </div>
  )
}

function UnauthenticatedScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  return (
    <div className="auth-splash">
      <div className="auth-card">
        <h1>BordChamp</h1>
        <p className="eyebrow">Place de marché agricole</p>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Se connecter</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Créer un compte</button>
        </div>
        {mode === 'login' ? <LoginForm /> : <RegisterForm />}
      </div>
    </div>
  )
}

function LoginForm() {
  const { login } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await login(email, password) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Connexion impossible') }
    finally { setBusy(false) }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>Adresse e-mail<input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Mot de passe<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="auth-error">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Vérification…' : 'Continuer'}</button>
    </form>
  )
}

function RegisterForm() {
  const { register } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return }
    setBusy(true); setError('')
    try { await register(email, password) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Inscription impossible") }
    finally { setBusy(false) }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>Adresse e-mail<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Mot de passe<input type="password" required autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirmer le mot de passe<input type="password" required autoComplete="new-password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <p className="auth-hint">10 caractères minimum, lettres, chiffres et un symbole.</p>
      {error && <p className="auth-error">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? "Création…" : "Créer mon compte"}</button>
    </form>
  )
}

function RegisterVerifyScreen() {
  const { registerState, verifyRegistration, cancelRegistration } = useSession()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!registerState) return
    QRCode.toDataURL(registerState.enrollment.otpauthUri, { width: 220, margin: 1 })
      .then(setQrDataUrl).catch(() => setQrDataUrl(null))
  }, [registerState])

  if (!registerState) return <SplashScreen message="Session d'inscription expirée." />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await verifyRegistration(code.trim()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Code invalide') }
    finally { setBusy(false) }
  }

  return (
    <div className="auth-splash">
      <div className="auth-card auth-card-wide">
        <h1>Activer Microsoft Authenticator</h1>
        <p className="auth-hint">Scannez le code QR avec Microsoft Authenticator (ou Google Authenticator) puis saisissez le code à 6 chiffres.</p>
        <div className="auth-mfa-grid">
          <div className="auth-qr">
            {qrDataUrl ? <img src={qrDataUrl} alt="Code QR d'enrôlement" width={220} height={220} /> : <div className="auth-qr-placeholder">Génération du QR…</div>}
            <p className="auth-secret">Code manuel : <code>{registerState.enrollment.secretBase32}</code></p>
          </div>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>Code à 6 chiffres<input inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} /></label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Vérification…' : 'Confirmer'}</button>
            <button type="button" className="ghost-button" onClick={cancelRegistration}>Annuler</button>
          </form>
        </div>
      </div>
    </div>
  )
}

function MfaChallengeScreen() {
  const { mfaState, verifyMfa, cancelMfa } = useSession()
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!mfaState) return <SplashScreen message="Session expirée." />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try { await verifyMfa(code.trim(), useRecovery) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Code invalide') }
    finally { setBusy(false) }
  }

  return (
    <div className="auth-splash">
      <div className="auth-card">
        <h1>Vérification en deux étapes</h1>
        <p className="auth-hint">Ouvrez Microsoft Authenticator pour {mfaState.email} et saisissez le code affiché.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>{useRecovery ? 'Code de récupération' : 'Code à 6 chiffres'}
            <input inputMode={useRecovery ? 'text' : 'numeric'} required value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <label className="auth-check"><input type="checkbox" checked={useRecovery} onChange={(event) => setUseRecovery(event.target.checked)} /> Utiliser un code de récupération</label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Vérification…' : 'Se connecter'}</button>
          <button type="button" className="ghost-button" onClick={cancelMfa}>Annuler</button>
        </form>
      </div>
    </div>
  )
}

function OnboardingProfileScreen() {
  const { session, refreshSession } = useSession()
  const [givenName, setGivenName] = useState('')
  const [surname, setSurname] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [locale, setLocale] = useState('fr-CI')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    setBusy(true); setError('')
    try {
      await callApi('/v1/me/onboarding/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': session.profile.etag },
        body: JSON.stringify({ givenName, surname, displayName: displayName || `${givenName} ${surname}`, locale }),
      })
      await refreshSession()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement impossible') }
    finally { setBusy(false) }
  }

  return (
    <div className="auth-splash">
      <div className="auth-card">
        <h1>Complétez votre profil</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>Prénom<input required value={givenName} onChange={(event) => setGivenName(event.target.value)} /></label>
          <label>Nom<input required value={surname} onChange={(event) => setSurname(event.target.value)} /></label>
          <label>Nom affiché<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Automatiquement à partir de vos noms" /></label>
          <label>Langue<select value={locale} onChange={(event) => setLocale(event.target.value)}>
            <option value="fr-CI">Français (Côte d'Ivoire)</option>
            <option value="fr-FR">Français (France)</option>
            <option value="en-US">English (US)</option>
          </select></label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Continuer'}</button>
        </form>
      </div>
    </div>
  )
}

const ORG_TYPES: Array<{ value: string; label: string }> = [
  { value: 'farmer', label: 'Exploitation agricole' },
  { value: 'cooperative', label: 'Coopérative' },
  { value: 'trader', label: 'Négociant' },
  { value: 'broker', label: 'Courtier' },
  { value: 'buyer', label: 'Acheteur' },
  { value: 'warehouse', label: 'Entrepôt' },
  { value: 'inspector', label: 'Inspection' },
  { value: 'logisticsProvider', label: 'Logistique' },
]

function OnboardingOrganizationScreen() {
  const { refreshSession, logout } = useSession()
  const [name, setName] = useState('')
  const [type, setType] = useState('farmer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await callApi('/v1/onboarding/organization', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type }),
      })
      await refreshSession()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Création impossible') }
    finally { setBusy(false) }
  }

  return (
    <div className="auth-splash">
      <div className="auth-card">
        <h1>Créez votre organisation</h1>
        <p className="auth-hint">Vous serez propriétaire du compte et pourrez inviter votre équipe ensuite.</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>Nom<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Type
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {ORG_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Création…' : 'Créer'}</button>
          <button type="button" className="ghost-button" onClick={logout}>Se déconnecter</button>
        </form>
      </div>
    </div>
  )
}

function RecoveryCodesScreen({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="auth-splash">
      <div className="auth-card">
        <h1>Codes de récupération</h1>
        <p className="auth-hint">Conservez ces codes en lieu sûr. Chaque code ne peut être utilisé qu'une seule fois.</p>
        <ul className="recovery-codes">{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
        <div className="auth-form">
          <button className="primary-button" type="button" onClick={() => downloadCodes(codes)}>Télécharger</button>
          <button className="ghost-button" type="button" onClick={onDone}>J'ai enregistré mes codes</button>
        </div>
      </div>
    </div>
  )
}

function downloadCodes(codes: string[]) {
  const blob = new Blob([codes.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bordchamp-recovery-codes.txt'
  a.click()
  URL.revokeObjectURL(url)
}

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { session, selectOrganization, logout } = useSession()
  const memberships = useMemo(() => session?.memberships ?? [], [session])
  if (!session) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <header className="modal-header">
          <h2>Mon compte</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">×</button>
        </header>
        <div className="modal-body">
          <p><strong>{session.profile.displayName ?? session.profile.email}</strong><br /><small>{session.profile.email}</small></p>
          <h3>Organisations</h3>
          <ul className="membership-list">
            {memberships.map((membership) => (
              <li key={membership.organizationId} className={membership.organizationId === session.activeOrganizationId ? 'active' : ''}>
                <div>
                  <strong>{session.organizations?.[membership.organizationId]?.name ?? membership.organizationId}</strong>
                  <small>{personaLabel(membership.personas[0])} · {membership.role}</small>
                </div>
                {membership.organizationId !== session.activeOrganizationId && (
                  <button className="ghost-button" type="button" onClick={() => selectOrganization(membership.organizationId)}>Sélectionner</button>
                )}
              </li>
            ))}
            {memberships.length === 0 && <li>Aucune organisation associée.</li>}
          </ul>
        </div>
        <footer className="modal-footer">
          <button className="ghost-button" type="button" onClick={logout}>Se déconnecter</button>
        </footer>
      </div>
    </div>
  )
}

async function callApi<T>(path: string, init: RequestInit): Promise<T> {
  const { getAccessToken } = await import('./auth')
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' })
  const parsed = (await response.json().catch(() => null)) as { data?: T; message?: string | string[] } | null
  if (!response.ok) {
    const message = parsed?.message
    throw new Error(Array.isArray(message) ? message.join(', ') : message ?? `Erreur HTTP ${response.status}`)
  }
  return parsed?.data as T
}
