import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { ReactNode } from 'react'
import { Activity, ArrowUpRight, BarChart3, Bell, Boxes, LayoutDashboard, Plus, RefreshCw, Settings, ShoppingBag, SlidersHorizontal, Sparkles } from 'lucide-react'

import {
  api,
  type Commodity,
  type Identity,
  type IntegrationEvent,
  type MarketSummary,
  type OrganizationSummary,
} from './api'
import { AccountDialog, AuthenticationBoundary, personaLabel } from './auth-ui'
import { CommodityVisual } from './product-image'
import { ErpWorkspace } from './erp'
import { OperationsWorkspace } from './operations'
import { SettingsWorkspace } from './settings'
import { useSession } from './session'
import { useLanguage, useT } from './i18n'

type View = 'overview' | 'erp' | 'operations' | 'market' | 'activity' | 'settings'

function App() {
  return <AuthenticationBoundary>{(identity) => <AuthenticatedApp identity={identity} />}</AuthenticationBoundary>
}

function AuthenticatedApp({ identity }: { identity: Identity }) {
  const { session } = useSession()
  const t = useT()
  const [view, setView] = useState<View>('overview')
  const [market, setMarket] = useState<MarketSummary | null>(null)
  const [commodities, setCommodities] = useState<Commodity[]>([])
  const [events, setEvents] = useState<IntegrationEvent[]>([])
  const [summary, setSummary] = useState<OrganizationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [showAccount, setShowAccount] = useState(false)
  const [showRfq, setShowRfq] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      const publicData = await Promise.allSettled([
        api<MarketSummary>('/v1/public/reports/market-summary'),
        api<Commodity[]>('/v1/public/reference-data/commodities'),
        api<IntegrationEvent[]>('/v1/integrations/events/public?limit=12'),
      ])
      if (cancelled) return
      if (publicData[0].status === 'fulfilled') setMarket(publicData[0].value)
      if (publicData[1].status === 'fulfilled') setCommodities(publicData[1].value)
      if (publicData[2].status === 'fulfilled') setEvents(publicData[2].value)
      const failed = publicData.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') setError(readError(failed.reason))

      if (identity.organizationId) {
        const privateData = await Promise.allSettled([
          api<OrganizationSummary>(`/v1/reports/organizations/${encodeURIComponent(identity.organizationId)}/summary`, identity),
          api<IntegrationEvent[]>('/v1/integrations/events/private?limit=12', identity),
        ])
        if (cancelled) return
        setSummary(privateData[0].status === 'fulfilled' ? privateData[0].value : null)
        if (privateData[1].status === 'fulfilled') {
          const privateEvents = privateData[1].value
          setEvents((current) => [...privateEvents, ...current]
            .sort((left, right) => right.sequenceId.localeCompare(left.sequenceId)).slice(0, 12))
        }
      } else setSummary(null)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [identity, refreshKey])

  const markets = market?.markets ?? []
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="BordChamp, accueil">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span><strong>BordChamp</strong><small>Marché agricole</small></span>
        </a>
        <nav aria-label={t('view.overview')}>
          <NavButton active={view === 'overview'} label={t('view.overview')} icon={<LayoutDashboard />} onClick={() => setView('overview')} />
          <NavButton active={view === 'market'} label="Marché" icon={<BarChart3 />} onClick={() => setView('market')} />
          <NavButton active={view === 'erp'} label="Offres" icon={<ShoppingBag />} onClick={() => setView('erp')} />
          <NavButton active={view === 'activity'} label={t('view.activity')} icon={<Activity />} onClick={() => setView('activity')} />
          {identity.persona === 'ExchangeAdmin' && <NavButton active={view === 'settings'} label={t('view.settings')} icon={<Settings />} onClick={() => setView('settings')} />}
        </nav>
        <div className="sidebar-section">
          <span className="eyebrow">Opérations</span>
          <button className="sidebar-action" type="button" onClick={() => setShowRfq(true)}><span><Plus /></span> Créer une offre</button>
          <button className="sidebar-action" type="button" onClick={() => setView('activity')}><span><Boxes /></span> Suivre les échanges</button>
          <button className="sidebar-action" type="button" onClick={() => setView('operations')}><span><SlidersHorizontal /></span> Console avancée</button>
        </div>
        <button className="identity-card" type="button" onClick={() => setShowAccount(true)}>
          <span className="avatar">{initials(displayNameOf(session?.profile) ?? personaLabel(identity.persona))}</span>
          <span className="identity-copy"><strong>{displayNameOf(session?.profile) ?? personaLabel(identity.persona)}</strong><small>{personaLabel(identity.persona)}</small></span>
          <span aria-hidden="true">⋯</span>
        </button>
      </aside>

      <main id="top">
        <header className="topbar">
          <div><span className="eyebrow">{t('shell.eyebrow')}</span><h1>{t(`view.${view}`)}</h1></div>
          <div className="top-actions">
            <span className={`api-state ${error ? 'is-offline' : ''}`}><i /> {error ? t('shell.status.offline') : t('shell.status.live')}</span>
            <LanguageSwitch />
            <button className="icon-button" type="button" title="Notifications"><Bell /></button>
            <button className="icon-button" type="button" title={t('shell.refresh')} onClick={() => setRefreshKey((key) => key + 1)}><RefreshCw /></button>
            <button className="top-identity" type="button" title="Compte et organisation" onClick={() => setShowAccount(true)}>{initials(personaLabel(identity.persona))}</button>
            <button className="primary-button" type="button" onClick={() => setShowRfq(true)}><span>＋</span> {t('shell.newOffer')}</button>
          </div>
        </header>

        {error && <div className="error-strip" role="status">{error}. Les données déjà chargées restent affichées.</div>}

        {view === 'overview' && <Overview commodities={commodities} loading={loading} markets={markets} summary={summary} events={events} onOpenMarket={() => setView('market')} onOpenActivity={() => setView('activity')} />}
        {view === 'erp' && <ErpWorkspace identity={identity} commodities={commodities} onConfigure={() => setShowAccount(true)} onAdvanced={() => setView('operations')} />}
        {view === 'operations' && <OperationsWorkspace identity={identity} commodities={commodities} onChanged={() => setRefreshKey((key) => key + 1)} onOrganizationCreated={() => setRefreshKey((key) => key + 1)} />}
        {view === 'market' && <MarketView commodities={commodities} markets={markets} loading={loading} />}
        {view === 'activity' && <ActivityView events={events} loading={loading} />}
        {view === 'settings' && <SettingsWorkspace identity={identity} />}
      </main>

      {showAccount && <AccountDialog onClose={() => setShowAccount(false)} />}
      {showRfq && <RfqDialog identity={identity} commodities={commodities} onClose={() => setShowRfq(false)} onCreated={() => { setShowRfq(false); setRefreshKey((key) => key + 1) }} />}
    </div>
  )
}

interface DashboardData {
  commodities: Commodity[]
  loading: boolean
  markets: MarketSummary['markets']
  summary: OrganizationSummary | null
  events: IntegrationEvent[]
}

function Overview({ commodities, loading, markets, summary, events, onOpenMarket, onOpenActivity }: DashboardData & { onOpenMarket: () => void; onOpenActivity: () => void }) {
  const inventory = total(summary?.inventoryByStatus)
  const openDeliveries = activeCount(summary?.deliveriesByStatus)
  const activeAlerts = activeCount(summary?.riskAlertsByStatus)
  return <div className="content-stack">
    <section className="overview-intro">
      <div className="overview-intro-copy">
        <span className="intro-kicker"><Sparkles /> Aujourd'hui sur BordChamp</span>
        <h2>Vos échanges, <em>en un coup d'œil.</em></h2>
        <p>Suivez la valeur du marché, vos lots et les opérations qui demandent votre attention.</p>
      </div>
      <button type="button" className="market-shortcut" onClick={onOpenMarket}>
        <span>Explorer le marché</span>
        <strong>{markets.length || commodities.length} produits</strong>
        <ArrowUpRight aria-hidden="true" />
      </button>
    </section>
    <section className="metric-grid" aria-label="Indicateurs clés">
      <Metric label="Volume échangé" value={formatVolume(markets)} detail={`${markets.reduce((sum, item) => sum + item.tradeCount, 0)} transactions`} />
      <Metric label="Valeur du marché" value={money(markets.reduce((sum, item) => sum + item.grossAmountMinor, 0))} detail="Volume brut exécuté" />
      <Metric label="Lots en portefeuille" value={String(inventory)} detail={summary ? statusDetail(summary.inventoryByStatus) : 'Organisation non connectée'} />
      <Metric label="À surveiller" value={String(openDeliveries + activeAlerts)} detail={`${openDeliveries} livraisons · ${activeAlerts} alertes`} tone={activeAlerts > 0 ? 'warning' : 'normal'} />
    </section>
    <section className="dashboard-grid">
      <div className="panel"><PanelHeading eyebrow="Cours exécutés" title="Marchés actifs" action="Tout voir" onAction={onOpenMarket} /><MarketTable commodities={commodities} markets={markets.slice(0, 5)} loading={loading} compact /></div>
      <div className="panel"><PanelHeading eyebrow="Temps réel" title="Derniers mouvements" action="Journal" onAction={onOpenActivity} /><EventList events={events.slice(0, 6)} loading={loading} /></div>
    </section>
    <section className="flow-band">
      <div><span className="eyebrow">Cycle sécurisé</span><h2>Du lot au règlement</h2></div>
      {['Stock qualifié', 'Offre négociée', 'Livraison tracée', 'Règlement confirmé'].map((label, index) => <div className="flow-step" key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}
    </section>
  </div>
}

function MarketView({ commodities, markets, loading }: Pick<DashboardData, 'commodities' | 'markets' | 'loading'>) {
  return <div className="content-stack">
    <section className="market-hero"><div><span className="eyebrow">Côte d'Ivoire · XOF</span><h2>Transactions agricoles exécutées</h2><p>Volumes et valeurs issus des confirmations de marché BordChamp.</p></div><div className="market-total"><small>Valeur totale</small><strong>{money(markets.reduce((sum, item) => sum + item.grossAmountMinor, 0))}</strong></div></section>
    <section className="panel"><PanelHeading eyebrow="Référentiel marché" title={`${markets.length || commodities.length} produits suivis`} /><MarketTable commodities={commodities} markets={markets} loading={loading} /></section>
  </div>
}

function ActivityView({ events, loading }: Pick<DashboardData, 'events' | 'loading'>) {
  return <div className="content-stack"><section className="panel journal-panel"><PanelHeading eyebrow="Flux séquencé" title="Journal d'activité" /><EventList events={events} loading={loading} detailed /></section></div>
}

function MarketTable({ commodities, markets, loading, compact = false }: Pick<DashboardData, 'commodities' | 'markets' | 'loading'> & { compact?: boolean }) {
  const fallback = commodities.slice(0, compact ? 5 : 12).map((item) => ({ commodityCode: item.code, tradeCount: 0, volume: 0, scale: 1, unitCode: 'KG', grossAmountMinor: 0 }))
  const rows = markets.length ? markets : fallback
  if (loading && rows.length === 0) return <LoadingRows />
  if (rows.length === 0) return <EmptyState title="Aucun marché disponible" detail="Le référentiel produit apparaîtra après la connexion à l'API." />
  return <div className="table-wrap"><table><thead><tr><th>Produit</th><th>Volume</th><th>Transactions</th><th>Valeur</th><th>État</th></tr></thead><tbody>{rows.map((item) => { const commodity = commodities.find((entry) => entry.code === item.commodityCode); return <tr key={`${item.commodityCode}-${item.unitCode}`}><td><CommodityVisual imageName={commodity?.imageName} iconName={commodity?.iconName} code={item.commodityCode} /><strong>{commodity?.name.fr ?? commodityName(item.commodityCode, commodities)}</strong><small>{item.commodityCode}</small></td><td>{quantity(item.volume, item.scale)} <small>{item.unitCode}</small></td><td>{item.tradeCount}</td><td><strong>{money(item.grossAmountMinor)}</strong></td><td><span className={`status-pill ${item.tradeCount ? 'is-live' : ''}`}>{item.tradeCount ? 'Actif' : 'Référencé'}</span></td></tr> })}</tbody></table></div>
}

function EventList({ events, loading, detailed = false }: { events: IntegrationEvent[]; loading: boolean; detailed?: boolean }) {
  if (loading && events.length === 0) return <LoadingRows />
  if (events.length === 0) return <EmptyState title="Aucun mouvement récent" detail="Les transactions et mises à jour apparaîtront ici." />
  return <div className={`event-list ${detailed ? 'is-detailed' : ''}`}>{events.map((event) => {
    const meta = eventMeta(event.topic)
    return <article className="event-row" key={`${event.sequenceId}-${event.id}`}><span className={`event-icon ${meta.tone}`}>{meta.symbol}</span><div><strong>{meta.label}</strong><p>{event.subjectId}</p>{detailed && <small>{event.sequenceId}</small>}</div><time dateTime={event.occurredAt}>{relativeDate(event.occurredAt)}</time></article>
  })}</div>
}

function RfqDialog({ identity, commodities, onClose, onCreated }: { identity: Identity; commodities: Commodity[]; onClose: () => void; onCreated: () => void }) {
  const [lotId, setLotId] = useState('')
  const [buyerIds, setBuyerIds] = useState('')
  const [expiresAt, setExpiresAt] = useState(() => localDateTime(new Date(Date.now() + 86_400_000)))
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!identity.organizationId) { setFormError("Configurez d'abord votre organisation."); return }
    setSubmitting(true); setFormError('')
    try {
      await api('/v1/trading/rfqs', identity, { method: 'POST', body: JSON.stringify({ lotId, invitedBuyerOrganizationIds: buyerIds.split(',').map((id) => id.trim()).filter(Boolean), expiresAt: new Date(expiresAt).toISOString() }) })
      onCreated()
    } catch (cause) { setFormError(readError(cause)); setSubmitting(false) }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="rfq-title"><DialogHeading title="Nouvelle offre de vente" detail="Réservez un lot disponible et invitez vos acheteurs." onClose={onClose} id="rfq-title" /><form onSubmit={(event) => void submit(event)}><label>Lot disponible<input required value={lotId} onChange={(event) => setLotId(event.target.value)} placeholder="Identifiant du lot" /></label><label>Organisations acheteuses<input required value={buyerIds} onChange={(event) => setBuyerIds(event.target.value)} placeholder="UUID, UUID" /><small>Séparez plusieurs identifiants par une virgule.</small></label><label>Clôture des cotations<input required type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>{commodities.length > 0 && <div className="form-note">{commodities.length} produits actifs dans le référentiel BordChamp.</div>}{formError && <div className="form-error" role="alert">{formError}</div>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Annuler</button><button className="primary-button" disabled={submitting} type="submit">{submitting ? 'Publication…' : "Publier l'offre"}</button></div></form></section></div>
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) { return <button className={`nav-button ${active ? 'is-active' : ''}`} type="button" onClick={onClick}><span>{icon}</span>{label}</button> }
function Metric({ label, value, detail, tone = 'normal' }: { label: string; value: string; detail: string; tone?: 'normal' | 'warning' }) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article> }
function PanelHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) { return <header className="panel-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action && <button type="button" onClick={onAction}>{action} <span>→</span></button>}</header> }
function DialogHeading({ title, detail, onClose, id }: { title: string; detail: string; onClose: () => void; id: string }) { return <header className="dialog-heading"><div><h2 id={id}>{title}</h2><p>{detail}</p></div><button className="icon-button" type="button" title="Fermer" onClick={onClose}>×</button></header> }
function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><span>◇</span><strong>{title}</strong><p>{detail}</p></div> }
function LoadingRows() { return <div className="loading-rows" aria-label="Chargement"><i /><i /><i /></div> }

function readError(cause: unknown) { return cause instanceof Error ? cause.message : 'Une erreur inattendue est survenue' }
function initials(value: string) { return value.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase() }
function displayNameOf(profile: { displayName?: string; givenName?: string; surname?: string; email: string } | undefined): string | undefined {
  if (!profile) return undefined
  if (profile.displayName?.trim()) return profile.displayName.trim()
  const combined = `${profile.givenName ?? ''} ${profile.surname ?? ''}`.trim()
  if (combined) return combined
  return profile.email
}
function LanguageSwitch() {
  const { language, setLanguage } = useLanguage()
  const t = useT()
  return <div className="lang-switch" role="group" aria-label={t('shell.lang.switch')}>
    <button type="button" className={language === 'fr' ? 'is-active' : ''} aria-pressed={language === 'fr'} onClick={() => setLanguage('fr')}>{t('shell.lang.fr')}</button>
    <button type="button" className={language === 'en' ? 'is-active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>{t('shell.lang.en')}</button>
  </div>
}
function total(values?: Record<string, number>) { return Object.values(values ?? {}).reduce((sum, value) => sum + value, 0) }
function activeCount(values?: Record<string, number>) { return Object.entries(values ?? {}).filter(([key]) => !['completed', 'resolved', 'released', 'cancelled'].includes(key)).reduce((sum, [, value]) => sum + value, 0) }
function statusDetail(values: Record<string, number>) { const entry = Object.entries(values).sort((left, right) => right[1] - left[1])[0]; return entry ? `${entry[1]} ${entry[0]}` : 'Aucun lot' }
function money(value: number) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(value) }
function quantity(value: number, scale: number) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: scale }).format(value / 10 ** scale) }
function formatVolume(markets: MarketSummary['markets']) { const value = markets.reduce((sum, market) => sum + market.volume / 10 ** market.scale, 0); return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value) + (markets[0]?.unitCode ? ` ${markets[0].unitCode}` : ' unités') }
function commodityName(code: string, commodities: Commodity[]) { return commodities.find((item) => item.code === code)?.name.fr ?? code.replaceAll('_', ' ') }
function relativeDate(value: string) { const timestamp = new Date(value).getTime(); if (!Number.isFinite(timestamp)) return 'À présent'; const minutes = Math.round((timestamp - Date.now()) / 60_000); const formatter = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' }); if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute'); const hours = Math.round(minutes / 60); if (Math.abs(hours) < 24) return formatter.format(hours, 'hour'); return formatter.format(Math.round(hours / 24), 'day') }
function localDateTime(value: Date) { const offset = value.getTimezoneOffset() * 60_000; return new Date(value.getTime() - offset).toISOString().slice(0, 16) }
function eventMeta(topic: string) { if (topic.includes('trade')) return { label: 'Transaction exécutée', symbol: '↗', tone: 'trade' }; if (topic.includes('settlement')) return { label: 'Règlement mis à jour', symbol: '✓', tone: 'settlement' }; if (topic.includes('delivery')) return { label: 'Livraison mise à jour', symbol: '→', tone: 'delivery' }; if (topic.includes('risk')) return { label: 'Alerte de risque', symbol: '!', tone: 'risk' }; return { label: 'Marché actualisé', symbol: '◆', tone: 'market' } }

export default App
