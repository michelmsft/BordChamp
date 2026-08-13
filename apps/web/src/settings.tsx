import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import {
  api,
  type AdminCommodity,
  type CommodityCategory,
  type CommodityStatus,
  type Identity,
  type InspectionGrade,
  type InspectionMetric,
  type InspectionScheme,
  type InspectionType,
  type MetricResultKind,
  type SchemeStatus,
  type StandardOperator,
  type Unit,
  type UnitDimension,
  type UnitStatus,
} from './api'
import { CommodityIcon, COMMODITY_ICON_NAMES } from './icons'

type Tab = 'units' | 'commodities' | 'schemes'

const CATEGORIES: readonly CommodityCategory[] = ['crop', 'aquaculture', 'liveAnimal', 'animalProduct']
const COMMODITY_STATUSES: readonly CommodityStatus[] = ['active', 'suspended', 'inactive']
const DIMENSIONS: readonly UnitDimension[] = ['mass', 'count', 'volume', 'length', 'temperature']
const UNIT_STATUSES: readonly UnitStatus[] = ['active', 'suspended', 'inactive']
const INSPECTION_TYPES: readonly InspectionType[] = ['quality', 'sanitary', 'veterinary', 'aquacultureHealth', 'coldChain']
const SCHEME_STATUSES: readonly SchemeStatus[] = ['active', 'suspended', 'inactive']
const RESULT_KINDS: readonly MetricResultKind[] = ['percentage', 'passFail', 'measurement', 'qualitative']
const OPERATORS: readonly StandardOperator[] = ['gte', 'lte', 'range', 'equals', 'qualitative']

export function SettingsWorkspace({ identity }: { identity: Identity }) {
  const [tab, setTab] = useState<Tab>('units')
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = () => setRefreshKey((k) => k + 1)

  return <div className="erp-layout">
    <aside className="erp-modules" aria-label="Paramètres">
      <header><strong>Référentiel</strong><small>Administration</small></header>
      <button className={tab === 'units' ? 'is-active' : ''} type="button" onClick={() => setTab('units')}><span>⚖</span><span>Unités</span></button>
      <button className={tab === 'commodities' ? 'is-active' : ''} type="button" onClick={() => setTab('commodities')}><span>◈</span><span>Produits</span></button>
      <button className={tab === 'schemes' ? 'is-active' : ''} type="button" onClick={() => setTab('schemes')}><span>✓</span><span>Contrôles</span></button>
    </aside>
    <section className="erp-content">
      {tab === 'units' && <UnitsTab identity={identity} refreshKey={refreshKey} onChanged={bump} />}
      {tab === 'commodities' && <CommoditiesTab identity={identity} refreshKey={refreshKey} onChanged={bump} />}
      {tab === 'schemes' && <SchemesTab identity={identity} refreshKey={refreshKey} onChanged={bump} />}
    </section>
  </div>
}

function UnitsTab({ identity, refreshKey, onChanged }: { identity: Identity; refreshKey: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useAdminList<Unit>('/v1/admin/reference-data/units', identity, refreshKey)
  const [edit, setEdit] = useState<Unit | null>(null)
  const [creating, setCreating] = useState(false)
  return <>
    <SettingsHeader title="Unités de mesure" subtitle={`${data?.length ?? 0} unité(s) au catalogue`} onCreate={() => setCreating(true)} onRefresh={reload} createLabel="Nouvelle unité" />
    {error && <div className="error-strip">{error}</div>}
    {loading && !data ? <div className="erp-loading"><i /><i /><i /></div> : <div className="table-wrap"><table><thead><tr><th>Code</th><th>Libellé</th><th>Dimension</th><th>Base</th><th>Facteur</th><th>Décimales</th><th>État</th><th></th></tr></thead><tbody>{(data ?? []).map((unit) => <tr key={unit.code} onClick={() => setEdit(unit)} style={{ cursor: 'pointer' }}><td><strong>{unit.code}</strong><small>{unit.label.en}</small></td><td>{unit.label.fr}</td><td>{dimensionLabel(unit.dimension)}</td><td>{unit.baseUnitCode ?? '—'}</td><td>{unit.factorToBase ?? '—'}</td><td>{unit.scale}</td><td><span className={`status-pill ${unit.status === 'active' ? 'is-live' : ''}`}>{statusLabel(unit.status)}</span></td><td>→</td></tr>)}</tbody></table></div>}
    {(edit || creating) && <UnitDialog identity={identity} unit={edit ?? undefined} onClose={() => { setEdit(null); setCreating(false) }} onSaved={() => { setEdit(null); setCreating(false); onChanged() }} />}
  </>
}

function CommoditiesTab({ identity, refreshKey, onChanged }: { identity: Identity; refreshKey: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useAdminList<AdminCommodity>('/v1/admin/reference-data/commodities', identity, refreshKey)
  const { data: units } = useAdminList<Unit>('/v1/admin/reference-data/units', identity, refreshKey)
  const [edit, setEdit] = useState<AdminCommodity | null>(null)
  const [creating, setCreating] = useState(false)
  return <>
    <SettingsHeader title="Produits" subtitle={`${data?.length ?? 0} produit(s) au catalogue`} onCreate={() => setCreating(true)} onRefresh={reload} createLabel="Nouveau produit" />
    {error && <div className="error-strip">{error}</div>}
    {loading && !data ? <div className="erp-loading"><i /><i /><i /></div> : <div className="table-wrap"><table><thead><tr><th>Produit</th><th>Catégorie</th><th>Unité par défaut</th><th>Unités autorisées</th><th>Public</th><th>État</th><th></th></tr></thead><tbody>{(data ?? []).map((c) => <tr key={c.code} onClick={() => setEdit(c)} style={{ cursor: 'pointer' }}><td><CommodityIcon name={c.iconName} code={c.code} /><strong>{c.name.fr}</strong><small>{c.code}</small></td><td>{categoryLabel(c.category)}</td><td>{c.defaultUnitCode ?? '—'}</td><td>{c.allowedUnitCodes.join(', ') || '—'}</td><td>{c.isPublic ? '✓' : '—'}</td><td><span className={`status-pill ${c.status === 'active' ? 'is-live' : ''}`}>{statusLabel(c.status)}</span></td><td>→</td></tr>)}</tbody></table></div>}
    {(edit || creating) && <CommodityDialog identity={identity} commodity={edit ?? undefined} units={units ?? []} onClose={() => { setEdit(null); setCreating(false) }} onSaved={() => { setEdit(null); setCreating(false); onChanged() }} />}
  </>
}

function SchemesTab({ identity, refreshKey, onChanged }: { identity: Identity; refreshKey: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useAdminList<InspectionScheme>('/v1/admin/reference-data/inspection-schemes', identity, refreshKey)
  const { data: commodities } = useAdminList<AdminCommodity>('/v1/admin/reference-data/commodities', identity, refreshKey)
  const { data: units } = useAdminList<Unit>('/v1/admin/reference-data/units', identity, refreshKey)
  const [edit, setEdit] = useState<InspectionScheme | null>(null)
  const [creating, setCreating] = useState(false)
  return <>
    <SettingsHeader title="Contrôles" subtitle={`${data?.length ?? 0} contrôle(s) définis`} onCreate={() => setCreating(true)} onRefresh={reload} createLabel="Nouveau contrôle" />
    {error && <div className="error-strip">{error}</div>}
    {loading && !data ? <div className="erp-loading"><i /><i /><i /></div> : <div className="table-wrap"><table><thead><tr><th>Contrôle</th><th>Produit</th><th>Type</th><th>Métriques</th><th>Classes</th><th>Mis à jour</th><th>État</th><th></th></tr></thead><tbody>{(data ?? []).map((scheme) => { const commodity = (commodities ?? []).find((c) => c.code === scheme.commodityCode); return <tr key={`${scheme.commodityCode}:${scheme.type}`} onClick={() => setEdit(scheme)} style={{ cursor: 'pointer' }}><td><CommodityIcon name={commodity?.iconName} code={scheme.commodityCode} /><strong>{scheme.label.fr}</strong><small>{commodity?.name.fr ?? scheme.commodityCode}</small></td><td>{scheme.commodityCode}</td><td>{inspectionTypeLabel(scheme.type)}</td><td>{scheme.metrics.length}</td><td>{scheme.grades.length}</td><td>{new Date(scheme.updatedAt).toLocaleDateString('fr-FR')}</td><td><span className={`status-pill ${scheme.status === 'active' ? 'is-live' : ''}`}>{statusLabel(scheme.status)}</span></td><td>→</td></tr> })}</tbody></table></div>}
    {(edit || creating) && <SchemeDialog identity={identity} scheme={edit ?? undefined} commodities={commodities ?? []} units={units ?? []} onClose={() => { setEdit(null); setCreating(false) }} onSaved={() => { setEdit(null); setCreating(false); onChanged() }} />}
  </>
}

function SettingsHeader({ title, subtitle, onCreate, onRefresh, createLabel }: { title: string; subtitle: string; onCreate: () => void; onRefresh: () => void; createLabel: string }) {
  return <header className="erp-heading"><div><span className="eyebrow">Paramètres</span><h2>{title}</h2><p>{subtitle}</p></div><div><button className="icon-button" type="button" title="Actualiser" onClick={onRefresh}>↻</button><button className="primary-button" type="button" onClick={onCreate}>＋ {createLabel}</button></div></header>
}

function UnitDialog({ identity, unit, onClose, onSaved }: { identity: Identity; unit?: Unit; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    code: unit?.code ?? '',
    labelEn: unit?.label.en ?? '',
    labelFr: unit?.label.fr ?? '',
    dimension: unit?.dimension ?? 'mass' as UnitDimension,
    baseUnitCode: unit?.baseUnitCode ?? '',
    factorToBase: unit?.factorToBase !== undefined ? String(unit.factorToBase) : '',
    scale: String(unit?.scale ?? 0),
    status: unit?.status ?? 'active' as UnitStatus,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = unit === undefined
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      await api(`/v1/admin/reference-data/units/${encodeURIComponent(form.code.toUpperCase())}`, identity, {
        method: 'PUT',
        body: JSON.stringify({
          labelEn: form.labelEn, labelFr: form.labelFr, dimension: form.dimension,
          ...(form.baseUnitCode ? { baseUnitCode: form.baseUnitCode.toUpperCase() } : {}),
          ...(form.factorToBase ? { factorToBase: Number(form.factorToBase) } : {}),
          scale: Number(form.scale), status: form.status,
        }),
      })
      onSaved()
    } catch (cause) { setErr(readError(cause)); setBusy(false) }
  }
  return <Dialog title={isNew ? 'Nouvelle unité' : `Unité ${unit?.code}`} detail="Définissez le code, la dimension et l'échelle." onClose={onClose} onSubmit={submit}>
    <label>Code<input required disabled={!isNew} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="KG" /></label>
    <div className="settings-grid-2"><label>Libellé (fr)<input required value={form.labelFr} onChange={(e) => setForm({ ...form, labelFr: e.target.value })} /></label><label>Libellé (en)<input required value={form.labelEn} onChange={(e) => setForm({ ...form, labelEn: e.target.value })} /></label></div>
    <div className="settings-grid-2"><label>Dimension<select value={form.dimension} onChange={(e) => setForm({ ...form, dimension: e.target.value as UnitDimension })}>{DIMENSIONS.map((d) => <option key={d} value={d}>{dimensionLabel(d)}</option>)}</select></label><label>État<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as UnitStatus })}>{UNIT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label></div>
    <div className="settings-grid-2"><label>Unité de base<input value={form.baseUnitCode} onChange={(e) => setForm({ ...form, baseUnitCode: e.target.value.toUpperCase() })} placeholder="KG" /><small>Optionnel</small></label><label>Facteur vers base<input value={form.factorToBase} onChange={(e) => setForm({ ...form, factorToBase: e.target.value })} placeholder="0.001" inputMode="decimal" /><small>Optionnel</small></label></div>
    <label>Décimales<input required type="number" min={0} value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })} /></label>
    {err && <div className="form-error" role="alert">{err}</div>}
    <DialogActions busy={busy} onCancel={onClose} label={isNew ? 'Créer' : 'Enregistrer'} />
  </Dialog>
}

function CommodityDialog({ identity, commodity, units, onClose, onSaved }: { identity: Identity; commodity?: AdminCommodity; units: readonly Unit[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    code: commodity?.code ?? '',
    nameFr: commodity?.name.fr ?? '',
    nameEn: commodity?.name.en ?? '',
    category: commodity?.category ?? 'crop' as CommodityCategory,
    iconName: commodity?.iconName ?? '',
    defaultUnitCode: commodity?.defaultUnitCode ?? '',
    allowedUnitCodes: commodity?.allowedUnitCodes ?? [],
    isPublic: commodity?.isPublic ?? true,
    status: commodity?.status ?? 'active' as CommodityStatus,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = commodity === undefined
  function toggleAllowedUnit(code: string) {
    const set = new Set(form.allowedUnitCodes)
    if (set.has(code)) set.delete(code); else set.add(code)
    setForm({ ...form, allowedUnitCodes: [...set] })
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      await api(`/v1/admin/reference-data/commodities/${encodeURIComponent(form.code.toUpperCase())}`, identity, {
        method: 'PUT',
        body: JSON.stringify({
          category: form.category, nameEn: form.nameEn, nameFr: form.nameFr,
          ...(form.iconName ? { iconName: form.iconName } : {}),
          ...(form.defaultUnitCode ? { defaultUnitCode: form.defaultUnitCode.toUpperCase() } : {}),
          allowedUnitCodes: form.allowedUnitCodes,
          isPublic: form.isPublic, status: form.status,
        }),
      })
      onSaved()
    } catch (cause) { setErr(readError(cause)); setBusy(false) }
  }
  return <Dialog title={isNew ? 'Nouveau produit' : `Produit ${commodity?.name.fr}`} detail="Choisissez l'icône, la catégorie et les unités autorisées." onClose={onClose} onSubmit={submit} wide>
    <div className="settings-grid-2"><label>Code<input required disabled={!isNew} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replaceAll(/\s+/g, '_') })} placeholder="TOMATO" /></label><label>Catégorie<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CommodityCategory })}>{CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></label></div>
    <div className="settings-grid-2"><label>Nom (fr)<input required value={form.nameFr} onChange={(e) => setForm({ ...form, nameFr: e.target.value })} /></label><label>Nom (en)<input required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label></div>
    <div>
      <label style={{ marginBottom: 8 }}>Icône</label>
      <div className="icon-picker" role="radiogroup" aria-label="Icône du produit">
        <button type="button" role="radio" aria-checked={!form.iconName} className={form.iconName ? '' : 'is-selected'} onClick={() => setForm({ ...form, iconName: '' })} title="Aucune icône"><CommodityIcon code={form.code || '··'} /></button>
        {COMMODITY_ICON_NAMES.map((name) => <button key={name} type="button" role="radio" aria-checked={form.iconName === name} className={form.iconName === name ? 'is-selected' : ''} onClick={() => setForm({ ...form, iconName: name })} title={name}><CommodityIcon name={name} /></button>)}
      </div>
    </div>
    <div className="settings-grid-2"><label>Unité par défaut<select value={form.defaultUnitCode} onChange={(e) => setForm({ ...form, defaultUnitCode: e.target.value })}><option value="">—</option>{units.filter((u) => u.status === 'active').map((u) => <option key={u.code} value={u.code}>{u.code} · {u.label.fr}</option>)}</select></label><label>État<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CommodityStatus })}>{COMMODITY_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label></div>
    <div>
      <label style={{ marginBottom: 8 }}>Unités autorisées</label>
      <div className="unit-chips">{units.filter((u) => u.status === 'active').map((u) => <button key={u.code} type="button" className={form.allowedUnitCodes.includes(u.code) ? 'is-selected' : ''} onClick={() => toggleAllowedUnit(u.code)}>{u.code}</button>)}</div>
    </div>
    <label className="checkbox-row"><input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} /> Visible dans le référentiel public</label>
    {err && <div className="form-error" role="alert">{err}</div>}
    <DialogActions busy={busy} onCancel={onClose} label={isNew ? 'Créer' : 'Enregistrer'} />
  </Dialog>
}

function SchemeDialog({ identity, scheme, commodities, units, onClose, onSaved }: { identity: Identity; scheme?: InspectionScheme; commodities: readonly AdminCommodity[]; units: readonly Unit[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    commodityCode: scheme?.commodityCode ?? commodities[0]?.code ?? '',
    type: scheme?.type ?? 'quality' as InspectionType,
    labelFr: scheme?.label.fr ?? '',
    labelEn: scheme?.label.en ?? '',
    samplingHint: scheme?.samplingHint ?? '',
    status: scheme?.status ?? 'active' as SchemeStatus,
  })
  const [metrics, setMetrics] = useState<InspectionMetric[]>(scheme?.metrics ? [...scheme.metrics] : [])
  const [grades, setGrades] = useState<InspectionGrade[]>(scheme?.grades ? [...scheme.grades] : [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = scheme === undefined
  const activeUnitCodes = units.filter((u) => u.status === 'active').map((u) => u.code)

  function addMetric() { setMetrics([...metrics, { code: '', label: { fr: '', en: '' }, whatIsChecked: { fr: '', en: '' }, resultKind: 'percentage', standard: { operator: 'gte', threshold: 80 }, mandatory: true }]) }
  function updateMetric(index: number, patch: Partial<InspectionMetric>) { setMetrics(metrics.map((m, i) => i === index ? { ...m, ...patch } : m)) }
  function updateStandard(index: number, patch: Partial<InspectionMetric['standard']>) { setMetrics(metrics.map((m, i) => i === index ? { ...m, standard: { ...m.standard, ...patch } } : m)) }
  function removeMetric(index: number) { setMetrics(metrics.filter((_, i) => i !== index)) }
  function addGrade() { setGrades([...grades, { code: '', label: { fr: '', en: '' }, rank: grades.length + 1 }]) }
  function updateGrade(index: number, patch: Partial<InspectionGrade>) { setGrades(grades.map((g, i) => i === index ? { ...g, ...patch } : g)) }
  function removeGrade(index: number) { setGrades(grades.filter((_, i) => i !== index)) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.commodityCode) { setErr('Choisissez un produit'); return }
    if (metrics.length === 0) { setErr('Ajoutez au moins une métrique'); return }
    setBusy(true); setErr('')
    try {
      await api(`/v1/admin/reference-data/inspection-schemes/${encodeURIComponent(form.commodityCode)}/${encodeURIComponent(form.type)}`, identity, {
        method: 'PUT',
        body: JSON.stringify({
          labelEn: form.labelEn, labelFr: form.labelFr,
          ...(form.samplingHint ? { samplingHint: form.samplingHint } : {}),
          metrics, grades, status: form.status,
        }),
      })
      onSaved()
    } catch (cause) { setErr(readError(cause)); setBusy(false) }
  }

  return <Dialog title={isNew ? 'Nouveau contrôle' : `Contrôle ${scheme?.label.fr}`} detail="Définissez les critères d'inspection et les classes de qualité." onClose={onClose} onSubmit={submit} wide>
    <div className="settings-grid-2">
      <label>Produit<select disabled={!isNew} value={form.commodityCode} onChange={(e) => setForm({ ...form, commodityCode: e.target.value })}><option value="">—</option>{commodities.map((c) => <option key={c.code} value={c.code}>{c.name.fr} ({c.code})</option>)}</select></label>
      <label>Type d'inspection<select disabled={!isNew} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as InspectionType })}>{INSPECTION_TYPES.map((t) => <option key={t} value={t}>{inspectionTypeLabel(t)}</option>)}</select></label>
    </div>
    <div className="settings-grid-2"><label>Libellé (fr)<input required value={form.labelFr} onChange={(e) => setForm({ ...form, labelFr: e.target.value })} /></label><label>Libellé (en)<input required value={form.labelEn} onChange={(e) => setForm({ ...form, labelEn: e.target.value })} /></label></div>
    <label>Méthode d'échantillonnage<input value={form.samplingHint} onChange={(e) => setForm({ ...form, samplingHint: e.target.value })} placeholder="Échantillon aléatoire de 50 unités" /></label>
    <label>État<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SchemeStatus })}>{SCHEME_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>

    <div>
      <div className="settings-section-header"><h3>Métriques</h3><button type="button" className="secondary-button" onClick={addMetric}>＋ Ajouter</button></div>
      {metrics.length === 0 && <div className="empty-state"><span>◇</span><strong>Aucune métrique</strong><p>Ajoutez les critères d'inspection à évaluer.</p></div>}
      {metrics.map((metric, index) => <div className="metric-editor" key={index}>
        <div className="settings-grid-3">
          <label>Code<input required value={metric.code} onChange={(e) => updateMetric(index, { code: e.target.value.toUpperCase() })} placeholder="MATURITY" /></label>
          <label>Libellé (fr)<input required value={metric.label.fr} onChange={(e) => updateMetric(index, { label: { ...metric.label, fr: e.target.value } })} /></label>
          <label>Libellé (en)<input value={metric.label.en} onChange={(e) => updateMetric(index, { label: { ...metric.label, en: e.target.value } })} /></label>
        </div>
        <div className="settings-grid-2">
          <label>Ce qui est vérifié (fr)<input value={metric.whatIsChecked.fr} onChange={(e) => updateMetric(index, { whatIsChecked: { ...metric.whatIsChecked, fr: e.target.value } })} placeholder="Maturité/couleur" /></label>
          <label>Type de résultat<select value={metric.resultKind} onChange={(e) => updateMetric(index, { resultKind: e.target.value as MetricResultKind })}>{RESULT_KINDS.map((k) => <option key={k} value={k}>{resultKindLabel(k)}</option>)}</select></label>
        </div>
        <div className="settings-grid-3">
          <label>Opérateur<select value={metric.standard.operator} onChange={(e) => updateStandard(index, { operator: e.target.value as StandardOperator })}>{OPERATORS.map((o) => <option key={o} value={o}>{operatorLabel(o)}</option>)}</select></label>
          {['gte', 'lte', 'equals'].includes(metric.standard.operator) && <label>Seuil<input type="number" value={metric.standard.threshold ?? ''} onChange={(e) => updateStandard(index, { threshold: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>}
          {metric.standard.operator === 'range' && <><label>Min<input type="number" value={metric.standard.min ?? ''} onChange={(e) => updateStandard(index, { min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label><label>Max<input type="number" value={metric.standard.max ?? ''} onChange={(e) => updateStandard(index, { max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label></>}
          {metric.standard.operator === 'qualitative' && <label style={{ gridColumn: 'span 2' }}>Attendu<input value={metric.standard.text ?? ''} onChange={(e) => updateStandard(index, { text: e.target.value })} placeholder="Firm, not soft" /></label>}
          {metric.resultKind === 'measurement' && <label>Unité<select value={metric.standard.unitCode ?? ''} onChange={(e) => updateStandard(index, { unitCode: e.target.value || undefined })}><option value="">—</option>{activeUnitCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>}
        </div>
        <div className="metric-editor-footer">
          <label className="checkbox-row"><input type="checkbox" checked={metric.mandatory} onChange={(e) => updateMetric(index, { mandatory: e.target.checked })} /> Obligatoire</label>
          <button type="button" className="secondary-button" onClick={() => removeMetric(index)}>Retirer</button>
        </div>
      </div>)}
    </div>

    <div>
      <div className="settings-section-header"><h3>Classes de qualité</h3><button type="button" className="secondary-button" onClick={addGrade}>＋ Ajouter</button></div>
      {grades.length === 0 && <div className="empty-state"><span>◇</span><strong>Aucune classe</strong><p>Définissez au moins une classe (A, B, …).</p></div>}
      {grades.map((grade, index) => <div className="metric-editor" key={index}>
        <div className="settings-grid-3">
          <label>Code<input required value={grade.code} onChange={(e) => updateGrade(index, { code: e.target.value.toUpperCase() })} placeholder="A" /></label>
          <label>Libellé (fr)<input required value={grade.label.fr} onChange={(e) => updateGrade(index, { label: { ...grade.label, fr: e.target.value } })} placeholder="Classe A" /></label>
          <label>Rang<input required type="number" value={grade.rank} onChange={(e) => updateGrade(index, { rank: Number(e.target.value) })} /></label>
        </div>
        <div className="settings-grid-2">
          <label>Score minimum<input type="number" value={grade.minScore ?? ''} onChange={(e) => updateGrade(index, { minScore: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="90" /></label>
          <label>Passes requises<input value={(grade.requiredPasses ?? []).join(', ')} onChange={(e) => updateGrade(index, { requiredPasses: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })} placeholder="FIRMNESS, DECAY" /></label>
        </div>
        <div className="metric-editor-footer"><button type="button" className="secondary-button" onClick={() => removeGrade(index)}>Retirer</button></div>
      </div>)}
    </div>

    {err && <div className="form-error" role="alert">{err}</div>}
    <DialogActions busy={busy} onCancel={onClose} label={isNew ? 'Créer' : 'Enregistrer'} />
  </Dialog>
}

function Dialog({ title, detail, onClose, onSubmit, children, wide = false }: { title: string; detail: string; onClose: () => void; onSubmit: (event: FormEvent) => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`dialog ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <header className="dialog-heading"><div><h2 id="settings-dialog-title">{title}</h2><p>{detail}</p></div><button className="icon-button" type="button" title="Fermer" onClick={onClose}>×</button></header>
      <form onSubmit={onSubmit}>{children}</form>
    </section>
  </div>
}

function DialogActions({ busy, onCancel, label }: { busy: boolean; onCancel: () => void; label: string }) {
  return <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onCancel}>Annuler</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : label}</button></div>
}

function useAdminList<T>(path: string, identity: Identity, refreshKey: number) {
  const [data, setData] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useMemo(() => () => setReloadKey((k) => k + 1), [])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    api<T[]>(path, identity)
      .then((value) => { if (!cancelled) setData(value) })
      .catch((cause) => { if (!cancelled) setError(readError(cause)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path, identity, refreshKey, reloadKey])
  return { data, loading, error, reload }
}

function readError(cause: unknown) { return cause instanceof Error ? cause.message : 'Une erreur est survenue' }
function statusLabel(status: string) { return ({ active: 'Actif', suspended: 'Suspendu', inactive: 'Inactif' } as Record<string, string>)[status] ?? status }
function dimensionLabel(dimension: UnitDimension) { return ({ mass: 'Masse', count: 'Nombre', volume: 'Volume', length: 'Longueur', temperature: 'Température' } as const)[dimension] }
function categoryLabel(category: CommodityCategory) { return ({ crop: 'Culture', aquaculture: 'Aquaculture', liveAnimal: 'Animal vivant', animalProduct: 'Produit animal' } as const)[category] }
function inspectionTypeLabel(type: InspectionType) { return ({ quality: 'Qualité', sanitary: 'Sanitaire', veterinary: 'Vétérinaire', aquacultureHealth: 'Santé aquacole', coldChain: 'Chaîne du froid' } as const)[type] }
function resultKindLabel(kind: MetricResultKind) { return ({ percentage: 'Pourcentage', passFail: 'Réussi/Échoué', measurement: 'Mesure', qualitative: 'Qualitatif' } as const)[kind] }
function operatorLabel(op: StandardOperator) { return ({ gte: '≥ seuil', lte: '≤ seuil', range: 'Fourchette min–max', equals: '= seuil', qualitative: 'Description attendue' } as const)[op] }
