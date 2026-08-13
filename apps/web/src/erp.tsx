import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { api, type Commodity, type Identity } from './api'

type RecordValue = string | number | boolean | null | undefined | Quantity | readonly string[]
type ErpRecord = Record<string, RecordValue> & { id: string; etag?: string; status?: string }
interface Quantity { value: number; scale: number; unitCode: string }
interface ErpData {
  organizationId: string
  generatedAt: string
  organization: ErpRecord | null
  productionUnits: ErpRecord[]
  lots: ErpRecord[]
  inspections: ErpRecord[]
  warehouseReceipts: ErpRecord[]
  rfqs: ErpRecord[]
  quotes: ErpRecord[]
  trades: ErpRecord[]
  settlements: ErpRecord[]
  deliveries: ErpRecord[]
  disputes: ErpRecord[]
  documents: ErpRecord[]
  recalls: ErpRecord[]
  riskAlerts: ErpRecord[]
}

type ModuleId = 'home' | 'production' | 'stock' | 'quality' | 'warehouse' | 'sales' | 'finance' | 'logistics' | 'compliance'
type CreateKind = 'unit' | 'lot' | 'inspection' | 'rfq' | 'document'
type ActionKind = 'finalizeInspection' | 'quote' | 'pod' | 'decision'

interface RenderContext { readonly lots?: readonly ErpRecord[] }
interface Column { key: string; label: string; render?: (record: ErpRecord, ctx?: RenderContext) => string }
interface ModuleDefinition { id: ModuleId; label: string; eyebrow: string; title: string; collection?: keyof ErpData; columns?: readonly Column[]; create?: CreateKind; createLabel?: string }

const MODULES: readonly ModuleDefinition[] = [
  { id: 'home', label: 'À traiter', eyebrow: 'Centre de travail', title: 'Priorités opérationnelles' },
  { id: 'production', label: 'Production', eyebrow: 'Exploitation', title: 'Unités de production', collection: 'productionUnits', create: 'unit', createLabel: 'Nouvelle unité', columns: [{ key: 'name', label: 'Unité' }, { key: 'type', label: 'Type' }, { key: 'supportedCategory', label: 'Catégorie' }, { key: 'status', label: 'État' }] },
  { id: 'stock', label: 'Stocks', eyebrow: 'Inventaire', title: 'Lots agricoles', collection: 'lots', create: 'lot', createLabel: 'Nouveau lot', columns: [{ key: 'lotNumber', label: 'N° de lot' }, { key: 'commodityCode', label: 'Produit' }, { key: 'quantity', label: 'Quantité', render: (record) => formatQuantity(record.quantity) }, { key: 'originRegionCode', label: 'Origine' }, { key: 'status', label: 'État' }] },
  { id: 'quality', label: 'Qualité', eyebrow: 'Contrôle', title: 'Inspections et certificats', collection: 'inspections', create: 'inspection', createLabel: 'Planifier un contrôle', columns: [{ key: 'type', label: 'Inspection' }, { key: 'lotId', label: 'Lot', render: (record, ctx) => lotLabel(record.lotId, ctx?.lots) }, { key: 'assignedInspectorUserId', label: 'Inspecteur' }, { key: 'status', label: 'État' }] },
  { id: 'warehouse', label: 'Entrepôt', eyebrow: 'Garde physique', title: 'Récépissés de stockage', collection: 'warehouseReceipts', columns: [{ key: 'lotId', label: 'Lot', render: (record, ctx) => lotLabel(record.lotId, ctx?.lots) }, { key: 'quantity', label: 'Quantité', render: (record) => formatQuantity(record.quantity) }, { key: 'pledgeStatus', label: 'Nantissement' }, { key: 'status', label: 'État' }] },
  { id: 'sales', label: 'Ventes', eyebrow: 'Négociation', title: 'Offres et transactions', collection: 'rfqs', create: 'rfq', createLabel: 'Nouvelle offre', columns: [{ key: 'commodityCode', label: 'Produit' }, { key: 'quantity', label: 'Quantité', render: (record) => formatQuantity(record.quantity) }, { key: 'expiresAt', label: 'Échéance', render: (record) => dateTime(record.expiresAt) }, { key: 'status', label: 'État' }] },
  { id: 'finance', label: 'Finance', eyebrow: 'Règlements', title: 'Encaissements et décaissements', collection: 'settlements', columns: [{ key: 'providerReference', label: 'Référence' }, { key: 'totalAmountMinor', label: 'Montant', render: (record) => money(record.totalAmountMinor) }, { key: 'reconciliationStatus', label: 'Rapprochement' }, { key: 'status', label: 'État' }] },
  { id: 'logistics', label: 'Logistique', eyebrow: 'Exécution', title: 'Livraisons', collection: 'deliveries', columns: [{ key: 'tradeId', label: 'Transaction', render: (record) => short(record.tradeId) }, { key: 'assignedLogisticsUserId', label: 'Responsable' }, { key: 'updatedAt', label: 'Dernière mise à jour', render: (record) => dateTime(record.updatedAt) }, { key: 'status', label: 'État' }] },
  { id: 'compliance', label: 'Conformité', eyebrow: 'Conformité & risque', title: 'Documents et alertes', collection: 'documents', create: 'document', createLabel: 'Nouveau document', columns: [{ key: 'type', label: 'Document' }, { key: 'documentReference', label: 'Référence' }, { key: 'validUntil', label: 'Validité', render: (record) => dateTime(record.validUntil) }, { key: 'status', label: 'État' }] },
]

export function ErpWorkspace({ identity, commodities, onConfigure, onAdvanced }: { identity: Identity; commodities: Commodity[]; onConfigure: () => void; onAdvanced: () => void }) {
  const [data, setData] = useState<ErpData | null>(null)
  const [moduleId, setModuleId] = useState<ModuleId>('home')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<ErpRecord | null>(null)
  const [createKind, setCreateKind] = useState<CreateKind | null>(null)
  const [action, setAction] = useState<{ kind: ActionKind; record: ErpRecord } | null>(null)

  useEffect(() => {
    if (!identity.organizationId) { setData(null); return }
    let cancelled = false
    setLoading(true); setError('')
    api<ErpData>(`/v1/erp/organizations/${encodeURIComponent(identity.organizationId)}/workspace`, identity)
      .then((workspace) => { if (!cancelled) setData(workspace) })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Impossible de charger le dossier ERP') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [identity, refreshKey])

  if (!identity.organizationId) return <section className="erp-onboarding"><span>BC</span><div><p className="eyebrow">Démarrage ERP</p><h2>Choisissez votre organisation</h2><p>Votre espace de gestion affichera automatiquement les stocks, contrôles, ventes, règlements et livraisons autorisés.</p><button className="primary-button" type="button" onClick={onConfigure}>Configurer mon identité</button></div></section>

  const module = MODULES.find((item) => item.id === moduleId) ?? MODULES[0]
  const records = module.collection && data ? collection(data, module.collection) : []
  const statuses = [...new Set(records.map((record) => string(record.status)).filter(Boolean))]
  const filtered = records.filter((record) => (status === 'all' || record.status === status) && JSON.stringify(record).toLowerCase().includes(search.toLowerCase()))
  const tasks = data ? workQueue(data, identity) : []

  function changed() { setRefreshKey((key) => key + 1); setCreateKind(null); setAction(null); setSelected(null) }

  return <div className="erp-layout">
    <aside className="erp-modules" aria-label="Modules ERP">
      <header><strong>{string(data?.organization?.name) || 'Mon organisation'}</strong><small>{short(identity.organizationId)}</small></header>
      {MODULES.map((item) => <button className={item.id === moduleId ? 'is-active' : ''} type="button" key={item.id} onClick={() => { setModuleId(item.id); setSelected(null) }}><span>{moduleSymbol(item.id)}</span><span>{item.label}{item.id === 'home' && tasks.length > 0 && <b>{tasks.length}</b>}</span></button>)}
      <button className="advanced-link" type="button" onClick={onAdvanced}><span>⌘</span><span>Console avancée<small>Administration technique</small></span></button>
    </aside>

    <section className="erp-content">
      <header className="erp-heading"><div><span className="eyebrow">{module.eyebrow}</span><h2>{module.title}</h2><p>{module.id === 'home' ? `${tasks.length} action${tasks.length === 1 ? '' : 's'} nécessitent votre attention` : `${records.length} enregistrement${records.length === 1 ? '' : 's'} dans ce module`}</p></div><div><button className="icon-button" type="button" title="Actualiser" onClick={() => setRefreshKey((key) => key + 1)}>↻</button>{module.create && <button className="primary-button" type="button" onClick={() => setCreateKind(module.create ?? null)}>＋ {module.createLabel}</button>}</div></header>
      {error && <div className="error-strip">{error}</div>}
      {loading && !data ? <div className="erp-loading"><i /><i /><i /></div> : module.id === 'home' ? <ErpHome data={data} tasks={tasks} onSelect={(task) => { setModuleId(task.module); setSelected(task.record) }} /> : <>
        <div className="erp-toolbar"><label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher dans ce module" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tous les états</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></div>
        <RecordTable columns={module.columns ?? []} records={filtered} onSelect={setSelected} emptyLabel={`Aucun enregistrement dans ${module.label.toLowerCase()}`} lots={data?.lots} />
        {module.id === 'sales' && data && <SecondarySection title="Transactions confirmées" records={data.trades} columns={[{ key: 'commodityCode', label: 'Produit' }, { key: 'buyerOrganizationId', label: 'Acheteur', render: (record) => short(record.buyerOrganizationId) }, { key: 'grossAmountMinor', label: 'Montant', render: (record) => money(record.grossAmountMinor) }, { key: 'executedAt', label: 'Exécutée', render: (record) => dateTime(record.executedAt) }]} onSelect={setSelected} />}
        {module.id === 'compliance' && data && <SecondarySection title="Alertes de risque" records={data.riskAlerts} columns={[{ key: 'type', label: 'Alerte' }, { key: 'severity', label: 'Sévérité' }, { key: 'subjectId', label: 'Sujet', render: (record) => short(record.subjectId) }, { key: 'status', label: 'État' }]} onSelect={setSelected} />}
      </>}
    </section>

    {selected && <RecordDrawer record={selected} module={moduleId} identity={identity} data={data} onClose={() => setSelected(null)} onChanged={changed} onAction={(kind) => setAction({ kind, record: selected })} />}
    {createKind && <CreateDialog kind={createKind} identity={identity} commodities={commodities} data={data} onClose={() => setCreateKind(null)} onCreated={changed} />}
    {action && <ActionDialog action={action} identity={identity} onClose={() => setAction(null)} onChanged={changed} />}
  </div>
}

interface WorkItem { id: string; title: string; detail: string; tone: string; module: ModuleId; record: ErpRecord }
function workQueue(data: ErpData, identity: Identity): WorkItem[] {
  const tasks: WorkItem[] = []
  for (const lot of data.lots.filter((record) => record.status === 'draft')) tasks.push({ id: `lot-${lot.id}`, title: 'Lot à rendre disponible', detail: `${string(lot.lotNumber) || short(lot.id)} · ${string(lot.commodityCode)} · ${formatQuantity(lot.quantity)}`, tone: 'stock', module: 'stock', record: lot })
  for (const inspection of data.inspections.filter((record) => record.status === 'assigned')) tasks.push({ id: `inspection-${inspection.id}`, title: identity.persona === 'Inspector' ? 'Inspection à finaliser' : 'Inspection en attente', detail: `${string(inspection.type)} · lot ${lotLabel(inspection.lotId, data.lots)}`, tone: 'quality', module: 'quality', record: inspection })
  for (const rfq of data.rfqs.filter((record) => record.status === 'open')) tasks.push({ id: `rfq-${rfq.id}`, title: string(rfq.sellerOrganizationId) === identity.organizationId ? 'Offre en attente de cotation' : 'Offre à coter', detail: `${string(rfq.commodityCode)} · ${formatQuantity(rfq.quantity)}`, tone: 'sales', module: 'sales', record: rfq })
  for (const settlement of data.settlements.filter((record) => !['released', 'refunded'].includes(string(record.status)))) tasks.push({ id: `settlement-${settlement.id}`, title: 'Règlement en cours', detail: `${money(settlement.totalAmountMinor)} · ${statusLabel(string(settlement.status))}`, tone: 'finance', module: 'finance', record: settlement })
  for (const delivery of data.deliveries.filter((record) => !['accepted', 'rejected', 'partiallyAccepted'].includes(string(record.status)))) tasks.push({ id: `delivery-${delivery.id}`, title: 'Livraison à faire avancer', detail: statusLabel(string(delivery.status)), tone: 'logistics', module: 'logistics', record: delivery })
  for (const alert of data.riskAlerts.filter((record) => record.status !== 'resolved')) tasks.push({ id: `alert-${alert.id}`, title: string(alert.type) || 'Alerte de risque', detail: `${string(alert.severity)} · ${statusLabel(string(alert.status))}`, tone: 'risk', module: 'compliance', record: alert })
  return tasks
}

function ErpHome({ data, tasks, onSelect }: { data: ErpData | null; tasks: WorkItem[]; onSelect: (task: WorkItem) => void }) {
  const openValue = data?.settlements.filter((item) => !['released', 'refunded'].includes(string(item.status))).reduce((sum, item) => sum + numeric(item.totalAmountMinor), 0) ?? 0
  return <div className="erp-home">
    <section className="erp-kpis"><article><span>Lots actifs</span><strong>{data?.lots.filter((item) => item.status !== 'inactive').length ?? 0}</strong><small>{data?.lots.filter((item) => item.status === 'available').length ?? 0} disponibles à la vente</small></article><article><span>Contrôles ouverts</span><strong>{data?.inspections.filter((item) => item.status === 'assigned').length ?? 0}</strong><small>Qualité et conformité</small></article><article><span>Ventes ouvertes</span><strong>{data?.rfqs.filter((item) => item.status === 'open').length ?? 0}</strong><small>{data?.trades.length ?? 0} transactions confirmées</small></article><article><span>Encours financier</span><strong>{money(openValue)}</strong><small>Règlements non clôturés</small></article></section>
    <section className="erp-workqueue"><header><div><span className="eyebrow">File de travail</span><h3>Prochaines actions</h3></div><span>{tasks.length} au total</span></header>{tasks.length ? tasks.map((task) => <button type="button" key={task.id} onClick={() => onSelect(task)}><span className={`task-symbol ${task.tone}`}>{moduleSymbol(task.module)}</span><span><strong>{task.title}</strong><small>{task.detail}</small></span><span>→</span></button>) : <div className="erp-empty"><span>✓</span><strong>Tout est à jour</strong><p>Aucune action opérationnelle n'est en attente.</p></div>}</section>
    <section className="erp-flow"><div><span className="eyebrow">Chaîne de valeur</span><h3>Exécution de bout en bout</h3></div>{[['Production', data?.productionUnits.length], ['Stock', data?.lots.length], ['Qualité', data?.inspections.length], ['Ventes', data?.trades.length], ['Livraisons', data?.deliveries.length]].map(([label, value], index) => <article key={String(label)}><span>{index + 1}</span><strong>{label}</strong><small>{value ?? 0} dossier(s)</small></article>)}</section>
  </div>
}

function RecordTable({ columns, records, onSelect, emptyLabel, lots }: { columns: readonly Column[]; records: ErpRecord[]; onSelect: (record: ErpRecord) => void; emptyLabel: string; lots?: readonly ErpRecord[] }) {
  if (!records.length) return <div className="erp-empty table-empty"><span>◇</span><strong>{emptyLabel}</strong><p>Créez un enregistrement ou modifiez vos filtres.</p></div>
  const ctx: RenderContext = { lots }
  return <div className="erp-table"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}<th aria-label="Ouvrir" /></tr></thead><tbody>{records.map((record) => <tr key={record.id} onClick={() => onSelect(record)}>{columns.map((column) => <td key={column.key}>{column.key === 'status' || column.key === 'pledgeStatus' || column.key === 'reconciliationStatus' ? <Status value={string(record[column.key])} /> : column.render ? column.render(record, ctx) : string(record[column.key]) || '—'}</td>)}<td><button type="button" title="Ouvrir le dossier" onClick={(event) => { event.stopPropagation(); onSelect(record) }}>→</button></td></tr>)}</tbody></table></div>
}

function SecondarySection({ title, records, columns, onSelect }: { title: string; records: ErpRecord[]; columns: readonly Column[]; onSelect: (record: ErpRecord) => void }) { return <section className="erp-secondary"><header><h3>{title}</h3><span>{records.length}</span></header><RecordTable records={records} columns={columns} onSelect={onSelect} emptyLabel={`Aucun élément dans ${title.toLowerCase()}`} /></section> }

function RecordDrawer({ record, module, identity, data, onClose, onChanged, onAction }: { record: ErpRecord; module: ModuleId; identity: Identity; data: ErpData | null; onClose: () => void; onChanged: () => void; onAction: (kind: ActionKind) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const actions = drawerActions(module, record, identity, data)
  async function quick(action: string) {
    setBusy(true); setError('')
    try {
      if (action === 'available') await api(`/v1/inventory/lots/${record.id}/mark-available`, identity, { method: 'POST', headers: { 'if-match': string(record.etag) } })
      else if (action === 'acceptQuote') { const quote = data?.quotes.find((item) => item.rfqId === record.id); if (!quote) throw new Error('Aucune cotation disponible'); await api(`/v1/trading/rfqs/${record.id}/accept`, identity, { method: 'POST', headers: { 'if-match': string(record.etag) }, body: JSON.stringify({ quoteId: quote.id }) }) }
      else if (action === 'milestone') { const next = record.status === 'assigned' ? 'pickedUp' : record.status === 'pickedUp' ? 'inTransit' : 'arrived'; await api(`/v1/deliveries/${record.id}/milestones/${next}`, identity, { method: 'POST', headers: { 'if-match': string(record.etag) }, body: '{}' }) }
      else if (action === 'acknowledge') await api(`/v1/risk/organizations/${identity.organizationId}/alerts/${record.id}/acknowledge`, identity, { method: 'POST', headers: { 'if-match': string(record.etag) } })
      onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "L'action a échoué") }
    finally { setBusy(false) }
  }
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="record-drawer" aria-label="Détail du dossier"><header><div><span className="eyebrow">{module}</span><h2>{recordTitle(module, record)}</h2><p>{short(record.id)}</p></div><button className="icon-button" type="button" onClick={onClose}>×</button></header><div className="record-status"><Status value={string(record.status) || string(record.pledgeStatus)} /><small>Mis à jour {dateTime(record.updatedAt ?? record.createdAt)}</small></div><dl>{Object.entries(record).filter(([key, value]) => !['etag'].includes(key) && value !== undefined && value !== null).map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{/lotids?$/i.test(key) ? (Array.isArray(value) ? value.map((id) => lotLabel(id, data?.lots)).join(', ') : lotLabel(value, data?.lots)) : key === 'quantity' ? formatQuantity(value) : key.toLowerCase().includes('amount') ? money(value) : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>{error && <div className="form-error">{error}</div>}{actions.length > 0 && <footer>{actions.map((action) => <button className={action.primary ? 'primary-button' : 'secondary-button'} disabled={busy} type="button" key={action.id} onClick={() => action.dialog ? onAction(action.dialog) : void quick(action.id)}>{action.label}</button>)}</footer>}</aside></div>
}

function drawerActions(module: ModuleId, record: ErpRecord, identity: Identity, data: ErpData | null) {
  const result: { id: string; label: string; primary?: boolean; dialog?: ActionKind }[] = []
  if (module === 'stock' && record.status === 'draft') result.push({ id: 'available', label: 'Rendre disponible', primary: true })
  if (module === 'quality' && record.status === 'assigned' && identity.persona === 'Inspector') result.push({ id: 'finalize', label: "Finaliser l'inspection", primary: true, dialog: 'finalizeInspection' })
  if (module === 'sales' && record.status === 'open' && record.sellerOrganizationId !== identity.organizationId) result.push({ id: 'quote', label: 'Déposer une cotation', primary: true, dialog: 'quote' })
  if (module === 'sales' && record.status === 'open' && record.sellerOrganizationId === identity.organizationId && data?.quotes.some((quote) => quote.rfqId === record.id)) result.push({ id: 'acceptQuote', label: 'Accepter la cotation', primary: true })
  if (module === 'logistics' && ['assigned', 'pickedUp', 'inTransit'].includes(string(record.status)) && identity.persona === 'LogisticsProvider') result.push({ id: 'milestone', label: record.status === 'assigned' ? 'Confirmer le retrait' : record.status === 'pickedUp' ? 'Passer en transit' : "Confirmer l'arrivée", primary: true })
  if (module === 'logistics' && record.status === 'arrived' && identity.persona === 'LogisticsProvider') result.push({ id: 'pod', label: 'Soumettre la preuve', primary: true, dialog: 'pod' })
  if (module === 'logistics' && record.status === 'podSubmitted' && ['Buyer', 'Trader'].includes(identity.persona)) result.push({ id: 'decision', label: 'Décider la réception', primary: true, dialog: 'decision' })
  if (module === 'compliance' && record.status === 'open' && record.severity) result.push({ id: 'acknowledge', label: 'Accuser réception', primary: true })
  return result
}

function CreateDialog({ kind, identity, commodities, data, onClose, onCreated }: { kind: CreateKind; identity: Identity; commodities: Commodity[]; data: ErpData | null; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => createDefaults(kind, commodities, data))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await requireActiveOrganization(identity)
      if (kind === 'unit') await api('/v1/production-units', identity, { method: 'POST', body: JSON.stringify({ ownerOrganizationId: identity.organizationId, name: form.name, type: form.type, supportedCategory: form.category }) })
      if (kind === 'lot') await api('/v1/inventory/lots', identity, { method: 'POST', body: JSON.stringify({ ownerOrganizationId: identity.organizationId, category: form.category, commodityCode: form.commodityCode, ...(form.productionUnitId ? { productionUnitId: form.productionUnitId } : {}), quantity: { value: Number(form.value), scale: Number(form.scale), unitCode: form.unitCode }, ...(form.originRegionCode ? { originRegionCode: form.originRegionCode } : {}) }) })
      if (kind === 'inspection') await api('/v1/inspections', identity, { method: 'POST', body: JSON.stringify({ lotId: form.lotId, type: form.type, assignedInspectorUserId: form.inspector }) })
      if (kind === 'rfq') await api('/v1/trading/rfqs', identity, { method: 'POST', body: JSON.stringify({ lotId: form.lotId, invitedBuyerOrganizationIds: form.buyers.split(',').map((value) => value.trim()).filter(Boolean), expiresAt: new Date(form.expiresAt).toISOString() }) })
      if (kind === 'document') await api('/v1/compliance/documents', identity, { method: 'POST', body: JSON.stringify({ organizationId: identity.organizationId, type: form.type, documentReference: form.reference, evidenceReference: form.evidence, issuedAt: form.issuedAt, validUntil: form.validUntil }) })
      onCreated()
    } catch (cause) { setError(erpError(cause)) }
    finally { setBusy(false) }
  }
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog erp-dialog" role="dialog" aria-modal="true"><header className="dialog-heading"><div><span className="eyebrow">Nouveau dossier</span><h2>{createTitle(kind)}</h2><p>Les champs métier remplacent les identifiants techniques du formulaire avancé.</p></div><button className="icon-button" type="button" onClick={onClose}>×</button></header><form onSubmit={(event) => void submit(event)}>{kind === 'unit' && <><Field label="Nom" value={form.name} onChange={(value) => update('name', value)} /><Select label="Type d'unité" value={form.type} options={['field', 'greenhouse', 'pond', 'tank', 'cage', 'barn', 'coop', 'pen', 'snailery', 'processingFacility']} onChange={(value) => update('type', value)} /><Select label="Production" value={form.category} options={['crop', 'aquaculture', 'liveAnimal', 'animalProduct']} onChange={(value) => update('category', value)} /></>}{kind === 'lot' && <><Select label="Produit" value={form.commodityCode} options={commodities.map((item) => item.code)} onChange={(value) => { const commodity = commodities.find((item) => item.code === value); update('commodityCode', value); if (commodity) update('category', commodity.category) }} /><Select label="Unité de production" value={form.productionUnitId} options={['', ...(data?.productionUnits.map((item) => item.id) ?? [])]} onChange={(value) => update('productionUnitId', value)} /><div className="field-row"><Field label="Quantité" type="number" value={form.value} onChange={(value) => update('value', value)} /><Field label="Décimales" type="number" value={form.scale} onChange={(value) => update('scale', value)} /><Field label="Unité" value={form.unitCode} onChange={(value) => update('unitCode', value)} /></div><Field label="Région d'origine" value={form.originRegionCode} onChange={(value) => update('originRegionCode', value)} /></>}{kind === 'inspection' && <><Select label="Lot à contrôler" value={form.lotId} options={data?.lots.map((item) => ({ value: string(item.id), label: string(item.lotNumber) || short(item.id) })) ?? []} onChange={(value) => update('lotId', value)} /><Select label="Type de contrôle" value={form.type} options={['quality', 'sanitary', 'veterinary', 'aquacultureHealth', 'coldChain']} onChange={(value) => update('type', value)} /><Field label="Inspecteur assigné" value={form.inspector} onChange={(value) => update('inspector', value)} /></>}{kind === 'rfq' && <><Select label="Lot disponible" value={form.lotId} options={data?.lots.filter((item) => item.status === 'available').map((item) => ({ value: string(item.id), label: string(item.lotNumber) || short(item.id) })) ?? []} onChange={(value) => update('lotId', value)} /><Field label="Organisations acheteuses" value={form.buyers} placeholder="UUID, UUID" onChange={(value) => update('buyers', value)} /><Field label="Clôture" type="datetime-local" value={form.expiresAt} onChange={(value) => update('expiresAt', value)} /></>}{kind === 'document' && <><Field label="Type de document" value={form.type} onChange={(value) => update('type', value)} /><Field label="Référence" value={form.reference} onChange={(value) => update('reference', value)} /><Field label="Preuve" value={form.evidence} onChange={(value) => update('evidence', value)} /><div className="field-row"><Field label="Émis le" type="date" value={form.issuedAt} onChange={(value) => update('issuedAt', value)} /><Field label="Valide jusqu'au" type="date" value={form.validUntil} onChange={(value) => update('validUntil', value)} /></div></>}{error && <div className="form-error">{error}</div>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Annuler</button><button className="primary-button" disabled={busy} type="submit">{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div></form></section></div>
}

function ActionDialog({ action, identity, onClose, onChanged }: { action: { kind: ActionKind; record: ErpRecord }; identity: Identity; onClose: () => void; onChanged: () => void }) {
  const [form, setForm] = useState({ outcome: 'pass', certificate: '', findingCode: 'QUALITY', findingResult: 'pass', notes: '', unitPrice: '800', recipient: '', evidence: '', accepted: '1000', rejected: '0', scale: '1', unit: 'KG', reason: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const headers = { 'if-match': string(action.record.etag) }
      if (action.kind === 'finalizeInspection') await api(`/v1/inspections/${action.record.id}/finalize`, identity, { method: 'POST', headers, body: JSON.stringify({ outcome: form.outcome, certificateNumber: form.certificate, findings: [{ code: form.findingCode, result: form.findingResult, ...(form.notes ? { notes: form.notes } : {}) }] }) })
      if (action.kind === 'quote') await api(`/v1/trading/rfqs/${action.record.id}/quotes`, identity, { method: 'POST', body: JSON.stringify({ unitPriceMinor: Number(form.unitPrice) }) })
      if (action.kind === 'pod') await api(`/v1/deliveries/${action.record.id}/pod`, identity, { method: 'POST', headers, body: JSON.stringify({ recipientName: form.recipient, evidenceReference: form.evidence }) })
      if (action.kind === 'decision') await api(`/v1/deliveries/${action.record.id}/decision`, identity, { method: 'POST', headers, body: JSON.stringify({ acceptedQuantity: { value: Number(form.accepted), scale: Number(form.scale), unitCode: form.unit }, rejectedQuantity: { value: Number(form.rejected), scale: Number(form.scale), unitCode: form.unit }, ...(form.reason ? { rejectionReason: form.reason } : {}) }) })
      onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "L'action a échoué") }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><section className="dialog erp-dialog" role="dialog" aria-modal="true"><header className="dialog-heading"><div><span className="eyebrow">Action métier</span><h2>{actionTitle(action.kind)}</h2><p>Dossier {short(action.record.id)}</p></div><button className="icon-button" type="button" onClick={onClose}>×</button></header><form onSubmit={(event) => void submit(event)}>{action.kind === 'finalizeInspection' && <><Select label="Conclusion" value={form.outcome} options={['pass', 'fail']} onChange={(value) => update('outcome', value)} /><Field label="Numéro de certificat" value={form.certificate} onChange={(value) => update('certificate', value)} /><Field label="Code du constat" value={form.findingCode} onChange={(value) => update('findingCode', value)} /><Select label="Résultat" value={form.findingResult} options={['pass', 'fail', 'notApplicable']} onChange={(value) => update('findingResult', value)} /><Field label="Notes" required={false} value={form.notes} onChange={(value) => update('notes', value)} /></>}{action.kind === 'quote' && <Field label="Prix unitaire XOF" type="number" value={form.unitPrice} onChange={(value) => update('unitPrice', value)} />}{action.kind === 'pod' && <><Field label="Destinataire" value={form.recipient} onChange={(value) => update('recipient', value)} /><Field label="Référence de preuve" value={form.evidence} onChange={(value) => update('evidence', value)} /></>}{action.kind === 'decision' && <><div className="field-row"><Field label="Quantité acceptée" type="number" value={form.accepted} onChange={(value) => update('accepted', value)} /><Field label="Quantité rejetée" type="number" value={form.rejected} onChange={(value) => update('rejected', value)} /></div><div className="field-row"><Field label="Décimales" type="number" value={form.scale} onChange={(value) => update('scale', value)} /><Field label="Unité" value={form.unit} onChange={(value) => update('unit', value)} /></div><Field label="Motif de rejet" required={false} value={form.reason} onChange={(value) => update('reason', value)} /></>}{error && <div className="form-error">{error}</div>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Annuler</button><button className="primary-button" disabled={busy} type="submit">Confirmer</button></div></form></section></div>
}

function Field({ label, value, onChange, type = 'text', placeholder, required = true }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean }) { return <label><span>{label}</span><input required={required} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label> }
function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly (string | { value: string; label: string })[]; onChange: (value: string) => void }) { return <label><span>{label}</span><select required value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => { const raw = typeof option === 'string' ? { value: option, label: option } : option; return <option key={raw.value || 'none'} value={raw.value}>{raw.label || 'Aucune'}</option> })}</select></label> }
function Status({ value }: { value: string }) { return <span className={`erp-status status-${value}`}>{statusLabel(value || 'unknown')}</span> }
function collection(data: ErpData, key: keyof ErpData) { const value = data[key]; return Array.isArray(value) ? value as ErpRecord[] : [] }
function string(value: RecordValue) { return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value) }
function numeric(value: RecordValue) { return typeof value === 'number' ? value : 0 }
function short(value: RecordValue) { const text = string(value); return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text || '—' }
function lotLabel(lotId: RecordValue, lots?: readonly ErpRecord[]) { const id = string(lotId); if (!id) return '—'; const lot = lots?.find((item) => string(item.id) === id); const number = lot ? string(lot.lotNumber) : ''; return number || short(id) }
function money(value: RecordValue) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(numeric(value)) }
function formatQuantity(value: RecordValue) { if (!isQuantity(value)) return '—'; return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: value.scale }).format(value.value / 10 ** value.scale)} ${value.unitCode}` }
function isQuantity(value: RecordValue): value is Quantity { return typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value && 'scale' in value && 'unitCode' in value }
function dateTime(value: RecordValue) { const text = string(value); if (!text) return '—'; const date = new Date(text); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : text }
function statusLabel(value: string) { const labels: Record<string, string> = { draft: 'Brouillon', available: 'Disponible', reserved: 'Réservé', quarantined: 'Quarantaine', sold: 'Vendu', inactive: 'Inactif', assigned: 'Assignée', finalized: 'Finalisée', open: 'Ouvert', accepted: 'Accepté', cancelled: 'Annulé', awaitingFunding: 'À financer', funded: 'Financé', deliveryHold: 'En attente', releasePending: 'Libération en cours', refundPending: 'Remboursement en cours', released: 'Libéré', refunded: 'Remboursé', pickedUp: 'Retirée', inTransit: 'En transit', arrived: 'Arrivée', podSubmitted: 'Preuve soumise', partiallyAccepted: 'Partiellement accepté', rejected: 'Rejeté', submitted: 'Soumis', approved: 'Approuvé', acknowledged: 'Pris en compte', resolved: 'Résolu', none: 'Libre', pledged: 'Nanti', pending: 'En attente', matched: 'Rapproché' }; return labels[value] ?? value }
function moduleSymbol(id: ModuleId) { return ({ home: '✓', production: '⌂', stock: '▤', quality: '◈', warehouse: '▦', sales: '↗', finance: '₣', logistics: '→', compliance: '!' } as const)[id] }
function recordTitle(module: ModuleId, record: ErpRecord) { if (module === 'stock') return `${string(record.lotNumber) || short(record.id)} · ${string(record.commodityCode)} · ${formatQuantity(record.quantity)}`; if (module === 'production') return string(record.name) || 'Unité de production'; if (module === 'sales') return `Offre ${short(record.id)}`; if (module === 'finance') return string(record.providerReference) || `Règlement ${short(record.id)}`; return `${MODULES.find((item) => item.id === module)?.label ?? 'Dossier'} ${short(record.id)}` }
function fieldLabel(key: string) { return key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()).replace('Id', 'ID') }
function createTitle(kind: CreateKind) { return ({ unit: 'Unité de production', lot: 'Lot agricole', inspection: 'Inspection', rfq: 'Offre de vente', document: 'Document de conformité' } as const)[kind] }
function actionTitle(kind: ActionKind) { return ({ finalizeInspection: "Finaliser l'inspection", quote: 'Déposer une cotation', pod: 'Preuve de livraison', decision: 'Décision de réception' } as const)[kind] }
function localDateTime(date: Date) { const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16) }
async function requireActiveOrganization(identity: Identity) { try { await api(`/v1/organizations/${encodeURIComponent(identity.organizationId)}`, identity) } catch (cause) { const message = cause instanceof Error ? cause.message : ''; if (message.includes('not found') || message.includes('404')) throw new Error("L'organisation active n'existe pas dans la base connectée. Ouvrez le sélecteur d'identité et choisissez une organisation valide, ou créez-en une depuis la Console avancée."); throw cause } }
function erpError(cause: unknown) { const message = cause instanceof Error ? cause.message : 'Création impossible'; return message === 'Owner organization not found' ? "L'organisation propriétaire n'existe pas dans la base connectée. Vérifiez l'organisation active dans votre identité." : message }
function createDefaults(kind: CreateKind, commodities: Commodity[], data: ErpData | null): Record<string, string> { const commodity = commodities.find((item) => item.code === 'TOMATO') ?? commodities[0]; const today = new Date().toISOString().slice(0, 10); if (kind === 'unit') return { name: '', type: 'field', category: 'crop' }; if (kind === 'lot') return { commodityCode: commodity?.code ?? 'TOMATO', category: commodity?.category ?? 'crop', productionUnitId: data?.productionUnits[0]?.id ?? '', value: '1000', scale: '1', unitCode: 'KG', originRegionCode: '' }; if (kind === 'inspection') return { lotId: data?.lots[0]?.id ?? '', type: 'quality', inspector: '' }; if (kind === 'rfq') return { lotId: data?.lots.find((item) => item.status === 'available')?.id ?? '', buyers: '', expiresAt: localDateTime(new Date(Date.now() + 86_400_000)) }; return { type: 'AGRICULTURAL_LICENSE', reference: '', evidence: '', issuedAt: today, validUntil: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10) } }