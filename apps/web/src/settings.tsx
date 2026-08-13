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
import { CommodityVisual, ProductImage } from './product-image'
import { PRODUCT_IMAGE_GROUPS, type ProductImageGroupId } from './product-images'

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
    {loading && !data ? <div className="erp-loading"><i /><i /><i /></div> : <div className="table-wrap"><table><thead><tr><th>Produit</th><th>Catégorie</th><th>Unité par défaut</th><th>Unités autorisées</th><th>Public</th><th>État</th><th></th></tr></thead><tbody>{(data ?? []).map((c) => <tr key={c.code} onClick={() => setEdit(c)} style={{ cursor: 'pointer' }}><td><CommodityVisual imageName={c.imageName} iconName={c.iconName} code={c.code} /><strong>{c.name.fr}</strong><small>{c.code}</small></td><td>{categoryLabel(c.category)}</td><td>{c.defaultUnitCode ?? '—'}</td><td>{c.allowedUnitCodes.join(', ') || '—'}</td><td>{c.isPublic ? '✓' : '—'}</td><td><span className={`status-pill ${c.status === 'active' ? 'is-live' : ''}`}>{statusLabel(c.status)}</span></td><td>→</td></tr>)}</tbody></table></div>}
    {(edit || creating) && <CommodityDialog identity={identity} commodity={edit ?? undefined} units={units ?? []} onClose={() => { setEdit(null); setCreating(false) }} onSaved={() => { setEdit(null); setCreating(false); onChanged() }} />}
  </>
}

function SchemesTab({ identity, refreshKey, onChanged }: { identity: Identity; refreshKey: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useAdminList<InspectionScheme>('/v1/admin/reference-data/inspection-schemes', identity, refreshKey)
  const { data: commodities } = useAdminList<AdminCommodity>('/v1/admin/reference-data/commodities', identity, refreshKey)
  const { data: units } = useAdminList<Unit>('/v1/admin/reference-data/units', identity, refreshKey)
  const [edit, setEdit] = useState<InspectionScheme | null>(null)
  const [duplicate, setDuplicate] = useState<InspectionScheme | null>(null)
  const [creating, setCreating] = useState(false)
  const closeDialog = () => { setEdit(null); setDuplicate(null); setCreating(false) }
  return <>
    <SettingsHeader title="Contrôles" subtitle={`${data?.length ?? 0} contrôle(s) définis`} onCreate={() => setCreating(true)} onRefresh={reload} createLabel="Nouveau contrôle" />
    {error && <div className="error-strip">{error}</div>}
    {loading && !data ? <div className="erp-loading"><i /><i /><i /></div> : <div className="table-wrap"><table><thead><tr><th>Contrôle</th><th>Produit</th><th>Type</th><th>Métriques</th><th>Classes</th><th>Mis à jour</th><th>État</th><th></th></tr></thead><tbody>{(data ?? []).map((scheme) => { const commodity = (commodities ?? []).find((c) => c.code === scheme.commodityCode); return <tr key={`${scheme.commodityCode}:${scheme.type}`} onClick={() => setEdit(scheme)} style={{ cursor: 'pointer' }}><td><CommodityVisual imageName={commodity?.imageName} iconName={commodity?.iconName} code={scheme.commodityCode} /><strong>{scheme.label.fr}</strong><small>{commodity?.name.fr ?? scheme.commodityCode}</small></td><td>{scheme.commodityCode}</td><td>{inspectionTypeLabel(scheme.type)}</td><td>{scheme.metrics.length}</td><td>{scheme.grades.length}</td><td>{new Date(scheme.updatedAt).toLocaleDateString('fr-FR')}</td><td><span className={`status-pill ${scheme.status === 'active' ? 'is-live' : ''}`}>{statusLabel(scheme.status)}</span></td><td><div className="row-actions"><button type="button" className="icon-button" title={`Dupliquer ${scheme.label.fr}`} onClick={(event) => { event.stopPropagation(); setDuplicate(scheme) }}>⧉</button><span>→</span></div></td></tr> })}</tbody></table></div>}
    {(edit || duplicate || creating) && <SchemeDialog identity={identity} scheme={edit ?? duplicate ?? undefined} duplicate={duplicate !== null} commodities={commodities ?? []} units={units ?? []} onClose={closeDialog} onSaved={() => { closeDialog(); onChanged() }} />}
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
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState('')
  const isNew = unit === undefined
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (form.baseUnitCode && form.baseUnitCode.toUpperCase() === form.code.toUpperCase()) {
      setErr('Une unité ne peut pas être sa propre unité de base.')
      return
    }
    setBusy(true)
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
  async function deleteUnit() {
    if (!unit) return
    setDeleting(true); setErr('')
    try {
      await api<void>(`/v1/admin/reference-data/units/${encodeURIComponent(unit.code)}`, identity, { method: 'DELETE' })
      onSaved()
    } catch (cause) { setErr(readError(cause)); setDeleting(false); setConfirmDelete(false) }
  }
  return <Dialog title={isNew ? 'Nouvelle unité' : `Unité ${unit?.code}`} detail="Définissez le code, la dimension et l'échelle." onClose={onClose} onSubmit={submit}>
    <label>Code<input required disabled={!isNew} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="KG" /></label>
    <div className="settings-grid-2"><label>Libellé (fr)<input required value={form.labelFr} onChange={(e) => setForm({ ...form, labelFr: e.target.value })} /></label><label>Libellé (en)<input required value={form.labelEn} onChange={(e) => setForm({ ...form, labelEn: e.target.value })} /></label></div>
    <div className="settings-grid-2"><label>Dimension<select value={form.dimension} onChange={(e) => setForm({ ...form, dimension: e.target.value as UnitDimension })}>{DIMENSIONS.map((d) => <option key={d} value={d}>{dimensionLabel(d)}</option>)}</select></label><label>État<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as UnitStatus })}>{UNIT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label></div>
    <div className="settings-grid-2"><label>Unité de base<input value={form.baseUnitCode} onChange={(e) => setForm({ ...form, baseUnitCode: e.target.value.toUpperCase() })} placeholder="KG" /><small>Optionnel</small></label><label>Facteur vers base<input value={form.factorToBase} onChange={(e) => setForm({ ...form, factorToBase: e.target.value })} placeholder="0.001" inputMode="decimal" /><small>Optionnel</small></label></div>
    <label>Décimales<input required type="number" min={0} value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })} /></label>
    {!isNew && <div className="unit-delete-row">
      {confirmDelete ? <><p>Supprimer définitivement l’unité <strong>{unit.code}</strong> ?</p><div><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Conserver</button><button type="button" className="danger-button" onClick={deleteUnit} disabled={deleting}>{deleting ? 'Suppression…' : 'Confirmer la suppression'}</button></div></> : <><p>La suppression est impossible si cette unité est encore utilisée.</p><button type="button" className="danger-button" onClick={() => setConfirmDelete(true)}>Supprimer l’unité</button></>}
    </div>}
    {err && <div className="form-error" role="alert">{err}</div>}
    <DialogActions busy={busy || deleting} onCancel={onClose} label={isNew ? 'Créer' : 'Enregistrer'} />
  </Dialog>
}

function CommodityDialog({ identity, commodity, units, onClose, onSaved }: { identity: Identity; commodity?: AdminCommodity; units: readonly Unit[]; onClose: () => void; onSaved: () => void }) {
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false)
  const [form, setForm] = useState({
    code: commodity?.code ?? '',
    nameFr: commodity?.name.fr ?? '',
    nameEn: commodity?.name.en ?? '',
    category: commodity?.category ?? 'crop' as CommodityCategory,
    imageName: commodity?.imageName ?? '',
    defaultUnitCode: commodity?.defaultUnitCode ?? '',
    allowedUnitCodes: commodity?.allowedUnitCodes ?? [],
    isPublic: commodity?.isPublic ?? true,
    status: commodity?.status ?? 'active' as CommodityStatus,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [imageGroup, setImageGroup] = useState<ProductImageGroupId>(() => imageGroupForCategory(commodity?.category ?? 'crop'))
  const isNew = commodity === undefined
  function toggleAllowedUnit(code: string) {
    const set = new Set(form.allowedUnitCodes)
    if (set.has(code)) set.delete(code); else set.add(code)
    setForm({ ...form, allowedUnitCodes: [...set] })
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (!form.code.trim() || !form.nameFr.trim() || !form.nameEn.trim()) {
      setErr('Renseignez le code et les noms français et anglais.')
      return
    }
    setBusy(true)
    try {
      await api(`/v1/admin/reference-data/commodities/${encodeURIComponent(form.code.toUpperCase())}`, identity, {
        method: 'PUT',
        body: JSON.stringify({
          category: form.category, nameEn: form.nameEn, nameFr: form.nameFr,
          ...(commodity?.iconName ? { iconName: commodity.iconName } : {}),
          ...(form.imageName ? { imageName: form.imageName } : {}),
          ...(form.defaultUnitCode ? { defaultUnitCode: form.defaultUnitCode.toUpperCase() } : {}),
          allowedUnitCodes: form.allowedUnitCodes,
          isPublic: form.isPublic, status: form.status,
        }),
      })
      onSaved()
    } catch (cause) { setErr(readError(cause)); setBusy(false) }
  }
  const visibleImages = PRODUCT_IMAGE_GROUPS.find((group) => group.id === imageGroup)?.images ?? []
  const activeUnits = units.filter((unit) => unit.status === 'active')
  return <Dialog title={isNew ? 'Créer un produit' : 'Modifier le produit'} detail="Configurez l'identité, la classification et les unités du produit." onClose={onClose} onSubmit={submit} wide className="product-editor-dialog">
    <div className="product-editor-top">
      <section className="product-editor-section product-visual-section">
        <SectionTitle symbol="▧" title="Image du produit" />
        <div className={`product-image-preview ${form.imageName ? '' : 'is-empty'}`}>
          {form.imageName ? <ProductImage name={form.imageName} alt={form.nameFr || 'Produit'} /> : <span>▧<small>Aucune image sélectionnée</small></span>}
        </div>
        <div className="product-image-actions">
          <button type="button" className="product-image-change" onClick={() => setImageLibraryOpen((open) => !open)}>▧ {form.imageName ? "Changer l'image" : 'Choisir une image'}</button>
          {form.imageName && <button type="button" className="product-image-remove" onClick={() => setForm({ ...form, imageName: '' })}>Retirer</button>}
        </div>
      </section>
      <section className="product-editor-section product-information-section">
        <SectionTitle symbol="ⓘ" title="Informations générales" />
        <div className="settings-grid-2"><label>Code <em>*</em><input required disabled={!isNew} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replaceAll(/\s+/g, '_') })} placeholder="TOMATO" /></label><label>Catégorie <em>*</em><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CommodityCategory })}>{CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></label></div>
        <div className="settings-grid-2"><label>Nom (français) <em>*</em><input required value={form.nameFr} onChange={(e) => setForm({ ...form, nameFr: e.target.value })} /></label><label>Nom (anglais) <em>*</em><input required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label></div>
      </section>
    </div>
    {imageLibraryOpen && <section className="product-editor-section product-library-section">
      <div className="settings-section-header"><SectionTitle symbol="▦" title="Bibliothèque d'images" /><button type="button" className="secondary-button" onClick={() => setImageLibraryOpen(false)}>Fermer</button></div>
      <div className="product-image-tabs" role="tablist" aria-label="Catégories d'images">
        {PRODUCT_IMAGE_GROUPS.map((group) => <button key={group.id} type="button" role="tab" aria-selected={imageGroup === group.id} className={imageGroup === group.id ? 'is-selected' : ''} onClick={() => setImageGroup(group.id)}>{group.label}</button>)}
      </div>
      <div className="product-image-picker" role="radiogroup" aria-label="Image du produit">
        {visibleImages.map((image) => <button key={image.name} type="button" role="radio" aria-label={image.label} aria-checked={form.imageName === image.name} className={form.imageName === image.name ? 'is-selected' : ''} onClick={() => { setForm({ ...form, imageName: image.name }); setImageLibraryOpen(false) }} title={image.label}><ProductImage name={image.name} alt="" /><span>{image.label}</span></button>)}
      </div>
    </section>}
    <section className="product-editor-section product-units-section">
      <SectionTitle symbol="⚖" title="Unités de commercialisation" detail="Sélectionnez les unités pouvant être utilisées pour ce produit." />
      <div className="product-units-layout">
        <label>Unité par défaut <em>*</em><select value={form.defaultUnitCode} onChange={(e) => setForm({ ...form, defaultUnitCode: e.target.value })}><option value="">—</option>{activeUnits.map((unit) => <option key={unit.code} value={unit.code}>{unit.code} · {unit.label.fr}</option>)}</select></label>
        <div><label>Unités autorisées <em>*</em></label><div className="product-unit-cards">{activeUnits.map((unit) => <button key={unit.code} type="button" className={form.allowedUnitCodes.includes(unit.code) ? 'is-selected' : ''} onClick={() => toggleAllowedUnit(unit.code)}><span className="unit-check">✓</span><strong>{unit.code}</strong><b>{unit.label.fr}</b><small>{unit.code.toLowerCase()}</small></button>)}</div></div>
      </div>
    </section>
    <section className="product-editor-section product-settings-section">
      <SectionTitle symbol="⚙" title="Paramètres" />
      <div className="product-settings-layout">
        <div><label>Statut <em>*</em></label><div className="product-status-options">{COMMODITY_STATUSES.map((status) => <label key={status}><input type="radio" name="commodity-status" value={status} checked={form.status === status} onChange={() => setForm({ ...form, status })} /><span><strong>{statusLabel(status)}</strong><small>{status === 'active' ? 'Le produit est disponible pour les transactions.' : 'Le produit n’est pas disponible.'}</small></span></label>)}</div></div>
        <label className="product-public-setting"><input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} /><span><strong>Visible dans le catalogue public</strong><small>Les utilisateurs peuvent rechercher et sélectionner ce produit.</small></span></label>
      </div>
    </section>
    {err && <div className="form-error" role="alert">{err}</div>}
    <DialogActions busy={busy} onCancel={onClose} label={isNew ? 'Créer le produit' : 'Enregistrer le produit'} />
  </Dialog>
}

function SectionTitle({ symbol, title, detail }: { symbol: string; title: string; detail?: string }) {
  return <header className="product-section-title"><span>{symbol}</span><div><h3>{title}</h3>{detail && <p>{detail}</p>}</div></header>
}

function SchemeDialog({ identity, scheme, duplicate = false, commodities, units, onClose, onSaved }: { identity: Identity; scheme?: InspectionScheme; duplicate?: boolean; commodities: readonly AdminCommodity[]; units: readonly Unit[]; onClose: () => void; onSaved: () => void }) {
  const [editorTab, setEditorTab] = useState<'information' | 'metrics' | 'grades'>('information')
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
  const isCreating = isNew || duplicate
  const activeUnitCodes = units.filter((u) => u.status === 'active').map((u) => u.code)

  function addMetric() { setEditorTab('metrics'); setMetrics([...metrics, { code: '', label: { fr: '', en: '' }, whatIsChecked: { fr: '', en: '' }, resultKind: 'percentage', standard: { operator: 'gte', threshold: 80 }, mandatory: true }]) }
  function updateMetric(index: number, patch: Partial<InspectionMetric>) { setMetrics(metrics.map((m, i) => i === index ? { ...m, ...patch } : m)) }
  function updateStandard(index: number, patch: Partial<InspectionMetric['standard']>) { setMetrics(metrics.map((m, i) => i === index ? { ...m, standard: { ...m.standard, ...patch } } : m)) }
  function removeMetric(index: number) { setMetrics(metrics.filter((_, i) => i !== index)) }
  function addGrade() { setEditorTab('grades'); setGrades([...grades, { code: '', label: { fr: '', en: '' }, rank: grades.length + 1 }]) }
  function updateGrade(index: number, patch: Partial<InspectionGrade>) { setGrades(grades.map((g, i) => i === index ? { ...g, ...patch } : g)) }
  function removeGrade(index: number) { setGrades(grades.filter((_, i) => i !== index)) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.commodityCode) { setEditorTab('information'); setErr('Choisissez un produit'); return }
    if (duplicate && scheme && form.commodityCode === scheme.commodityCode && form.type === scheme.type) { setEditorTab('information'); setErr('Choisissez un autre produit ou un autre type pour la copie'); return }
    if (metrics.length === 0) { setEditorTab('metrics'); setErr('Ajoutez au moins une métrique'); return }
    if (!form.labelFr.trim() || !form.labelEn.trim()) { setEditorTab('information'); setErr('Renseignez les libellés français et anglais du contrôle'); return }
    const incompleteMetric = metrics.findIndex((metric) => !metric.code.trim() || !metric.label.fr.trim() || !metric.label.en.trim() || !metric.whatIsChecked.fr.trim() || !metric.whatIsChecked.en.trim())
    if (incompleteMetric >= 0) { setEditorTab('metrics'); setErr(`Métrique ${incompleteMetric + 1} : renseignez le code, les libellés et ce qui est vérifié en français et en anglais`); return }
    const incompleteGrade = grades.findIndex((grade) => !grade.code.trim() || !grade.label.fr.trim() || !grade.label.en.trim())
    if (incompleteGrade >= 0) { setEditorTab('grades'); setErr(`Classe ${incompleteGrade + 1} : renseignez le code et les libellés français et anglais`); return }
    setBusy(true); setErr('')
    try {
      const path = isCreating ? '/v1/admin/reference-data/inspection-schemes' : `/v1/admin/reference-data/inspection-schemes/${encodeURIComponent(form.commodityCode)}/${encodeURIComponent(form.type)}`
      await api(path, identity, {
        method: isCreating ? 'POST' : 'PUT',
        body: JSON.stringify({
          ...(isCreating ? { commodityCode: form.commodityCode, type: form.type } : {}),
          labelEn: form.labelEn, labelFr: form.labelFr,
          ...(form.samplingHint ? { samplingHint: form.samplingHint } : {}),
          metrics, grades, status: form.status,
        }),
      })
      onSaved()
    } catch (cause) { setErr(readError(cause)); setBusy(false) }
  }

  return <Dialog title={duplicate ? `Dupliquer ${scheme?.label.fr}` : isNew ? 'Nouveau contrôle' : `Contrôle ${scheme?.label.fr}`} detail={duplicate ? "Choisissez une nouvelle combinaison produit/type pour créer la copie." : "Définissez les critères d'inspection et les classes de qualité."} onClose={onClose} onSubmit={submit} wide className="scheme-dialog">
    <div className="scheme-editor-tabs" role="tablist" aria-label="Configuration du contrôle">
      <button type="button" role="tab" aria-selected={editorTab === 'information'} aria-controls="scheme-information-panel" className={editorTab === 'information' ? 'is-selected' : ''} onClick={() => setEditorTab('information')}>Informations</button>
      <button type="button" role="tab" aria-selected={editorTab === 'metrics'} aria-controls="scheme-metrics-panel" className={editorTab === 'metrics' ? 'is-selected' : ''} onClick={() => setEditorTab('metrics')}>Métriques <span>{metrics.length}</span></button>
      <button type="button" role="tab" aria-selected={editorTab === 'grades'} aria-controls="scheme-grades-panel" className={editorTab === 'grades' ? 'is-selected' : ''} onClick={() => setEditorTab('grades')}>Classes de qualité <span>{grades.length}</span></button>
    </div>

    {editorTab === 'information' && <div id="scheme-information-panel" className="scheme-information-panel" role="tabpanel">
      <div className="settings-grid-2">
        <label>Produit<select disabled={!isCreating} value={form.commodityCode} onChange={(e) => setForm({ ...form, commodityCode: e.target.value })}><option value="">—</option>{commodities.map((c) => <option key={c.code} value={c.code}>{c.name.fr} ({c.code})</option>)}</select></label>
        <label>Type d'inspection<select disabled={!isCreating} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as InspectionType })}>{INSPECTION_TYPES.map((t) => <option key={t} value={t}>{inspectionTypeLabel(t)}</option>)}</select></label>
      </div>
      <div className="settings-grid-2"><label>Libellé (fr)<input required value={form.labelFr} onChange={(e) => setForm({ ...form, labelFr: e.target.value })} /></label><label>Libellé (en)<input required value={form.labelEn} onChange={(e) => setForm({ ...form, labelEn: e.target.value })} /></label></div>
      <label>Méthode d'échantillonnage<input value={form.samplingHint} onChange={(e) => setForm({ ...form, samplingHint: e.target.value })} placeholder="Échantillon aléatoire de 50 unités" /></label>
      <label>État<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SchemeStatus })}>{SCHEME_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
    </div>}

    {editorTab === 'metrics' && <div id="scheme-metrics-panel" role="tabpanel">
      <div className="settings-section-header"><h3>Métriques</h3><button type="button" className="secondary-button" onClick={addMetric}>＋ Ajouter</button></div>
      {metrics.length === 0 && <div className="empty-state"><span>◇</span><strong>Aucune métrique</strong><p>Ajoutez les critères d'inspection à évaluer.</p></div>}
      {metrics.length > 0 && <div className="metric-table-wrap"><table className="metric-table">
        <thead><tr><th>Code</th><th>Libellés</th><th>Ce qui est vérifié</th><th>Résultat</th><th>Standard</th><th>Obligatoire</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{metrics.map((metric, index) => <tr key={index}>
          <td><input required aria-label={`Code métrique ${index + 1}`} value={metric.code} onChange={(e) => updateMetric(index, { code: e.target.value.toUpperCase() })} placeholder="MATURITY" /></td>
          <td><div className="metric-cell-stack"><input required aria-label={`Libellé français métrique ${index + 1}`} value={metric.label.fr} onChange={(e) => updateMetric(index, { label: { ...metric.label, fr: e.target.value } })} placeholder="Français" /><input required aria-label={`Libellé anglais métrique ${index + 1}`} value={metric.label.en} onChange={(e) => updateMetric(index, { label: { ...metric.label, en: e.target.value } })} placeholder="English" /></div></td>
          <td><div className="metric-cell-stack"><input required aria-label={`Vérification française métrique ${index + 1}`} value={metric.whatIsChecked.fr} onChange={(e) => updateMetric(index, { whatIsChecked: { ...metric.whatIsChecked, fr: e.target.value } })} placeholder="Maturité/couleur" /><input required aria-label={`Vérification anglaise métrique ${index + 1}`} value={metric.whatIsChecked.en} onChange={(e) => updateMetric(index, { whatIsChecked: { ...metric.whatIsChecked, en: e.target.value } })} placeholder="Ripeness/color" /></div></td>
          <td><select aria-label={`Type de résultat métrique ${index + 1}`} value={metric.resultKind} onChange={(e) => updateMetric(index, { resultKind: e.target.value as MetricResultKind })}>{RESULT_KINDS.map((kind) => <option key={kind} value={kind}>{resultKindLabel(kind)}</option>)}</select></td>
          <td><div className="metric-standard-cell">
            <select aria-label={`Opérateur métrique ${index + 1}`} value={metric.standard.operator} onChange={(e) => updateStandard(index, { operator: e.target.value as StandardOperator })}>{OPERATORS.map((operator) => <option key={operator} value={operator}>{operatorLabel(operator)}</option>)}</select>
            {['gte', 'lte', 'equals'].includes(metric.standard.operator) && <input aria-label={`Seuil métrique ${index + 1}`} type="number" value={metric.standard.threshold ?? ''} onChange={(e) => updateStandard(index, { threshold: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="Seuil" />}
            {metric.standard.operator === 'range' && <div className="metric-range"><input aria-label={`Minimum métrique ${index + 1}`} type="number" value={metric.standard.min ?? ''} onChange={(e) => updateStandard(index, { min: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="Min" /><input aria-label={`Maximum métrique ${index + 1}`} type="number" value={metric.standard.max ?? ''} onChange={(e) => updateStandard(index, { max: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="Max" /></div>}
            {metric.standard.operator === 'qualitative' && <input aria-label={`Résultat attendu métrique ${index + 1}`} value={metric.standard.text ?? ''} onChange={(e) => updateStandard(index, { text: e.target.value })} placeholder="Résultat attendu" />}
            {metric.resultKind === 'measurement' && <select aria-label={`Unité métrique ${index + 1}`} value={metric.standard.unitCode ?? ''} onChange={(e) => updateStandard(index, { unitCode: e.target.value || undefined })}><option value="">Unité</option>{activeUnitCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select>}
          </div></td>
          <td className="metric-required-cell"><input aria-label={`Métrique ${index + 1} obligatoire`} type="checkbox" checked={metric.mandatory} onChange={(e) => updateMetric(index, { mandatory: e.target.checked })} /></td>
          <td className="metric-action-cell"><button type="button" className="icon-button" title={`Retirer la métrique ${index + 1}`} onClick={() => removeMetric(index)}>×</button></td>
        </tr>)}</tbody>
      </table></div>}
    </div>}

    {editorTab === 'grades' && <div id="scheme-grades-panel" role="tabpanel">
      <div className="settings-section-header"><h3>Classes de qualité</h3><button type="button" className="secondary-button" onClick={addGrade}>＋ Ajouter</button></div>
      {grades.length === 0 && <div className="empty-state"><span>◇</span><strong>Aucune classe</strong><p>Définissez au moins une classe (A, B, …).</p></div>}
      {grades.length > 0 && <div className="grade-table-wrap"><table className="grade-table">
        <thead><tr><th>Code</th><th>Libellés</th><th>Rang</th><th>Score minimum</th><th>Passes requises</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{grades.map((grade, index) => <tr key={index}>
          <td><input required aria-label={`Code classe ${index + 1}`} value={grade.code} onChange={(e) => updateGrade(index, { code: e.target.value.toUpperCase() })} placeholder="A" /></td>
          <td><div className="metric-cell-stack"><input required aria-label={`Libellé français classe ${index + 1}`} value={grade.label.fr} onChange={(e) => updateGrade(index, { label: { ...grade.label, fr: e.target.value } })} placeholder="Classe A" /><input required aria-label={`Libellé anglais classe ${index + 1}`} value={grade.label.en} onChange={(e) => updateGrade(index, { label: { ...grade.label, en: e.target.value } })} placeholder="Grade A" /></div></td>
          <td><input required aria-label={`Rang classe ${index + 1}`} type="number" min={1} value={grade.rank} onChange={(e) => updateGrade(index, { rank: Number(e.target.value) })} /></td>
          <td><input aria-label={`Score minimum classe ${index + 1}`} type="number" value={grade.minScore ?? ''} onChange={(e) => updateGrade(index, { minScore: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="90" /></td>
          <td><input aria-label={`Passes requises classe ${index + 1}`} value={(grade.requiredPasses ?? []).join(', ')} onChange={(e) => updateGrade(index, { requiredPasses: e.target.value.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean) })} placeholder="FIRMNESS, DECAY" /></td>
          <td className="metric-action-cell"><button type="button" className="icon-button" title={`Retirer la classe ${index + 1}`} onClick={() => removeGrade(index)}>×</button></td>
        </tr>)}</tbody>
      </table></div>}
    </div>}

    {err && <div className="form-error" role="alert">{err}</div>}
    <DialogActions busy={busy} onCancel={onClose} label={duplicate ? 'Créer la copie' : isNew ? 'Créer' : 'Enregistrer'} />
  </Dialog>
}

function Dialog({ title, detail, onClose, onSubmit, children, wide = false, className = '' }: { title: string; detail: string; onClose: () => void; onSubmit: (event: FormEvent) => void; children: ReactNode; wide?: boolean; className?: string }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`dialog ${wide ? 'is-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
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

function imageGroupForCategory(category: CommodityCategory) {
  return ({ crop: 'crop', aquaculture: 'aquaculture', liveAnimal: 'live-animal', animalProduct: 'animal-product' } as const)[category]
}
function inspectionTypeLabel(type: InspectionType) { return ({ quality: 'Qualité', sanitary: 'Sanitaire', veterinary: 'Vétérinaire', aquacultureHealth: 'Santé aquacole', coldChain: 'Chaîne du froid' } as const)[type] }
function resultKindLabel(kind: MetricResultKind) { return ({ percentage: 'Pourcentage', passFail: 'Réussi/Échoué', measurement: 'Mesure', qualitative: 'Qualitatif' } as const)[kind] }
function operatorLabel(op: StandardOperator) { return ({ gte: '≥ seuil', lte: '≤ seuil', range: 'Fourchette min–max', equals: '= seuil', qualitative: 'Description attendue' } as const)[op] }
