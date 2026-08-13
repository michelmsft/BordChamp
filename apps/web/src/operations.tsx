import { useEffect, useEffectEvent, useState } from 'react'

import { api, type Commodity, type Identity } from './api'

type Values = Record<string, string>
type Refs = Record<string, string>
type FieldType = 'text' | 'number' | 'datetime' | 'date' | 'textarea' | 'select'

interface Field {
  key: string
  label: string
  type?: FieldType
  required?: boolean
  placeholder?: string
  options?: readonly { value: string; label: string }[]
  initial?: string | ((refs: Refs) => string)
}

interface Command {
  id: string
  title: string
  description: string
  personas: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT'
  path: (values: Values, refs: Refs) => string
  fields?: readonly Field[]
  body?: (values: Values, refs: Refs) => unknown
  etag?: (refs: Refs) => string
  headers?: (values: Values) => Record<string, string>
  capture?: (data: unknown) => Refs
}

interface Group {
  id: string
  label: string
  description: string
  commands: readonly Command[]
}

const text = (key: string, label: string, initial?: Field['initial'], placeholder?: string): Field => ({ key, label, required: true, initial, placeholder })
const optional = (key: string, label: string, initial?: Field['initial'], placeholder?: string): Field => ({ key, label, initial, placeholder })
const number = (key: string, label: string, initial?: Field['initial']): Field => ({ key, label, type: 'number', required: true, initial })
const select = (key: string, label: string, values: readonly string[], initial?: string): Field => ({ key, label, type: 'select', required: true, initial: initial ?? values[0], options: values.map((value) => ({ value, label: value })) })
const ref = (key: string) => (refs: Refs) => refs[key] ?? ''
const required = (value: string | undefined, label: string) => { if (!value?.trim()) throw new Error(`${label} est requis`); return value.trim() }
const integer = (values: Values, key: string) => { const value = Number(required(values[key], key)); if (!Number.isSafeInteger(value)) throw new Error(`${key} doit être un entier`); return value }
const csv = (value: string | undefined) => required(value, 'Liste').split(',').map((item) => item.trim()).filter(Boolean)
const maybe = (value: string | undefined) => value?.trim() ? value.trim() : undefined
const quantity = (values: Values, prefix = '') => ({ value: integer(values, `${prefix}value`), scale: integer(values, `${prefix}scale`), unitCode: required(values[`${prefix}unitCode`], 'Unité').toUpperCase() })
const quantityFields = (prefix = ''): readonly Field[] => [number(`${prefix}value`, 'Quantité entière', '1000'), number(`${prefix}scale`, 'Décimales', '1'), text(`${prefix}unitCode`, 'Unité', 'KG')]
const pathRef = (refs: Refs, key: string) => encodeURIComponent(required(refs[key], key))
const entity = (data: unknown, nested?: string) => { const value = nested ? object(data)[nested] : data; return object(value) }
const capture = (idKey: string, etagKey: string, nested?: string) => (data: unknown): Refs => { const value = entity(data, nested); return { [idKey]: String(value.id ?? ''), [etagKey]: String(value.etag ?? '') } }
const captureListFirst = (idKey: string, etagKey: string) => (data: unknown): Refs => { const first = Array.isArray(data) ? data[0] : undefined; return first ? { [idKey]: String(object(first).id ?? ''), [etagKey]: String(object(first).etag ?? '') } : {} }
const withOptional = (base: Record<string, unknown>, values: Values, keys: readonly string[]) => { for (const key of keys) { const value = maybe(values[key]); if (value !== undefined) base[key] = value } return base }

const GROUPS: readonly Group[] = [
  {
    id: 'foundation', label: 'Fondation', description: "Organisation, mandats et unités d'exploitation.", commands: [
      { id: 'organization.create', title: 'Créer une organisation', description: 'Enregistre le participant et capture son identifiant.', personas: 'Participant ou Administration', method: 'POST', path: () => '/v1/organizations', fields: [text('name', 'Nom', 'Ferme BordChamp'), select('type', 'Type', ['farmer', 'cooperative', 'trader', 'broker', 'buyer', 'warehouse', 'inspector', 'logisticsProvider'], 'farmer')], body: (v) => ({ name: required(v.name, 'Nom'), type: v.type }), capture: capture('organizationId', 'organizationEtag') },
      { id: 'organization.get', title: "Actualiser l'organisation", description: "Recharge le profil et l'ETag courant.", personas: 'Propriétaire, mandataire, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/organizations/${pathRef(r, 'organizationId')}`, capture: capture('organizationId', 'organizationEtag') },
      { id: 'organization.rename', title: "Renommer l'organisation", description: 'Met à jour le nom avec contrôle de concurrence.', personas: 'Propriétaire, mandataire ou Admin', method: 'PATCH', path: (_v, r) => `/v1/organizations/${pathRef(r, 'organizationId')}`, fields: [text('name', 'Nouveau nom')], body: (v) => ({ name: required(v.name, 'Nom') }), etag: (r) => required(r.organizationEtag, 'ETag organisation'), capture: capture('organizationId', 'organizationEtag') },
      { id: 'organization.mandate', title: 'Créer un mandat', description: 'Autorise un autre utilisateur à représenter cette organisation.', personas: 'Propriétaire ou Admin', method: 'POST', path: (_v, r) => `/v1/organizations/${pathRef(r, 'organizationId')}/mandates`, fields: [text('granteeUserId', 'Utilisateur mandataire'), optional('validUntil', "Date d'expiration", undefined, '2026-12-31T23:59:59Z')], body: (v) => withOptional({ granteeUserId: required(v.granteeUserId, 'Utilisateur') }, v, ['validUntil']), capture: (data) => ({ mandateId: String(object(data).id ?? '') }) },
      { id: 'unit.create', title: 'Créer une unité de production', description: 'Déclare un champ, bassin, bâtiment ou site de transformation.', personas: 'Producteur, Coopérative ou Négociant', method: 'POST', path: () => '/v1/production-units', fields: [text('name', "Nom de l'unité", 'Site principal'), select('type', 'Type', ['field', 'greenhouse', 'pond', 'tank', 'cage', 'barn', 'coop', 'pen', 'snailery', 'processingFacility'], 'field'), select('supportedCategory', 'Catégorie', ['crop', 'aquaculture', 'liveAnimal', 'animalProduct'], 'crop')], body: (v, r) => ({ ownerOrganizationId: required(r.organizationId, 'Organisation'), name: required(v.name, 'Nom'), type: v.type, supportedCategory: v.supportedCategory }), capture: capture('productionUnitId', 'productionUnitEtag') },
      { id: 'unit.get', title: "Actualiser l'unité", description: "Recharge l'unité et son ETag.", personas: 'Propriétaire, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/production-units/${pathRef(r, 'productionUnitId')}`, capture: capture('productionUnitId', 'productionUnitEtag') },
      { id: 'unit.deactivate', title: "Désactiver l'unité", description: "Ferme administrativement l'unité sans supprimer son historique.", personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/production-units/${pathRef(r, 'productionUnitId')}/deactivate`, fields: [text('reason', 'Motif')], body: (v) => ({ reason: required(v.reason, 'Motif') }), etag: (r) => required(r.productionUnitEtag, 'ETag unité'), capture: capture('productionUnitId', 'productionUnitEtag') },
    ],
  },
  {
    id: 'inventory', label: 'Lots & traçabilité', description: 'Création, disponibilité, filiation et contrôle du stock.', commands: [
      { id: 'lot.create', title: 'Créer un lot', description: 'Crée un lot brouillon depuis une unité de production.', personas: 'Producteur, Coopérative ou Négociant', method: 'POST', path: () => '/v1/inventory/lots', fields: [select('category', 'Catégorie', ['crop', 'aquaculture', 'liveAnimal', 'animalProduct'], 'crop'), text('commodityCode', 'Code produit', 'TOMATO'), ...quantityFields(), optional('productionDate', 'Date de production', '', '2026-08-12'), optional('originRegionCode', "Région d'origine", 'ABIDJAN')], body: (v, r) => withOptional({ ownerOrganizationId: required(r.organizationId, 'Organisation'), category: v.category, commodityCode: required(v.commodityCode, 'Produit').toUpperCase(), quantity: quantity(v), ...(r.productionUnitId ? { productionUnitId: r.productionUnitId } : {}) }, v, ['productionDate', 'originRegionCode']), capture: capture('lotId', 'lotEtag') },
      { id: 'lot.get', title: 'Actualiser le lot', description: 'Recharge le lot et son état courant.', personas: 'Propriétaire, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/inventory/lots/${pathRef(r, 'lotId')}`, capture: capture('lotId', 'lotEtag') },
      { id: 'lot.quantity', title: 'Corriger la quantité', description: 'Ajuste un lot encore modifiable.', personas: 'Propriétaire ou mandataire', method: 'PATCH', path: (_v, r) => `/v1/inventory/lots/${pathRef(r, 'lotId')}/quantity`, fields: quantityFields(), body: (v) => quantity(v), etag: (r) => required(r.lotEtag, 'ETag lot'), capture: capture('lotId', 'lotEtag') },
      { id: 'lot.available', title: 'Rendre disponible', description: 'Ouvre le lot au stockage et à la négociation.', personas: 'Propriétaire ou mandataire', method: 'POST', path: (_v, r) => `/v1/inventory/lots/${pathRef(r, 'lotId')}/mark-available`, etag: (r) => required(r.lotEtag, 'ETag lot'), capture: capture('lotId', 'lotEtag') },
      { id: 'lot.quarantine', title: 'Mettre en quarantaine', description: 'Bloque les mouvements et la vente du lot.', personas: 'Propriétaire, Admin ou Régulateur', method: 'POST', path: (_v, r) => `/v1/inventory/lots/${pathRef(r, 'lotId')}/quarantine`, fields: [text('reason', 'Motif')], body: (v) => ({ reason: required(v.reason, 'Motif') }), etag: (r) => required(r.lotEtag, 'ETag lot'), capture: capture('lotId', 'lotEtag') },
      { id: 'lot.deactivate', title: 'Désactiver le lot', description: 'Retire définitivement le lot des opérations.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/inventory/lots/${pathRef(r, 'lotId')}/deactivate`, fields: [text('reason', 'Motif')], body: (v) => ({ reason: required(v.reason, 'Motif') }), etag: (r) => required(r.lotEtag, 'ETag lot'), capture: capture('lotId', 'lotEtag') },
      { id: 'lineage.create', title: 'Enregistrer une transformation', description: 'Relie des lots parents à un lot enfant.', personas: 'Propriétaire ou mandataire', method: 'POST', path: () => '/v1/traceability/lineage', fields: [text('parentLotIds', 'Lots parents, séparés par virgule', ref('lotId')), text('childLotId', 'Lot enfant'), text('transformationType', 'Transformation', 'conditionnement')], body: (v) => ({ parentLotIds: csv(v.parentLotIds), childLotId: required(v.childLotId, 'Lot enfant'), transformationType: required(v.transformationType, 'Transformation') }) },
      { id: 'lineage.get', title: 'Consulter la traçabilité', description: 'Affiche ancêtres, descendants et liens.', personas: 'Participant concerné, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/traceability/lots/${pathRef(r, 'lotId')}` },
    ],
  },
  {
    id: 'quality', label: 'Inspection & entrepôt', description: 'Contrôle qualité, certification et récépissés de stockage.', commands: [
      { id: 'inspection.create', title: 'Demander une inspection', description: 'Assigne le contrôle du lot à un inspecteur précis.', personas: 'Propriétaire du lot', method: 'POST', path: () => '/v1/inspections', fields: [select('type', "Type d'inspection", ['quality', 'sanitary', 'veterinary', 'aquacultureHealth', 'coldChain'], 'quality'), text('assignedInspectorUserId', 'Utilisateur inspecteur', 'inspector-1')], body: (v, r) => ({ lotId: required(r.lotId, 'Lot'), type: v.type, assignedInspectorUserId: required(v.assignedInspectorUserId, 'Inspecteur') }), capture: capture('inspectionId', 'inspectionEtag') },
      { id: 'inspection.get', title: "Actualiser l'inspection", description: "Recharge l'affectation ou le certificat final.", personas: 'Propriétaire, inspecteur assigné, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/inspections/${pathRef(r, 'inspectionId')}`, capture: capture('inspectionId', 'inspectionEtag') },
      { id: 'inspection.finalize', title: "Finaliser l'inspection", description: 'Émet le certificat; un échec place le lot en quarantaine.', personas: 'Inspecteur assigné', method: 'POST', path: (_v, r) => `/v1/inspections/${pathRef(r, 'inspectionId')}/finalize`, fields: [select('outcome', 'Conclusion', ['pass', 'fail'], 'pass'), text('certificateNumber', 'Numéro de certificat', 'CERT-2026-001'), text('findingCode', 'Code du constat', 'QUALITY'), select('findingResult', 'Résultat du constat', ['pass', 'fail', 'notApplicable'], 'pass'), optional('findingNotes', 'Notes du constat'), optional('gradeCode', 'Classe qualité', 'A'), optional('certificateValidUntil', 'Validité ISO', '', '2027-08-12T00:00:00Z')], body: (v) => withOptional({ outcome: v.outcome, certificateNumber: required(v.certificateNumber, 'Certificat'), findings: [{ code: required(v.findingCode, 'Code constat'), result: v.findingResult, ...(maybe(v.findingNotes) ? { notes: v.findingNotes.trim() } : {}) }] }, v, ['gradeCode', 'certificateValidUntil']), etag: (r) => required(r.inspectionEtag, 'ETag inspection'), capture: capture('inspectionId', 'inspectionEtag') },
      { id: 'receipt.create', title: 'Émettre un récépissé', description: 'Place la totalité du lot disponible sous garde entrepôt.', personas: "Opérateur d'entrepôt", method: 'POST', path: () => '/v1/warehouse-receipts', fields: quantityFields(), body: (v, r) => ({ warehouseOrganizationId: required(r.warehouseOrganizationId, 'Organisation entrepôt'), lotId: required(r.lotId, 'Lot'), quantity: quantity(v) }), capture: capture('receiptId', 'receiptEtag') },
      { id: 'receipt.get', title: 'Actualiser le récépissé', description: 'Recharge garde, propriété et nantissement.', personas: 'Entrepôt, propriétaire, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/warehouse-receipts/${pathRef(r, 'receiptId')}`, capture: capture('receiptId', 'receiptEtag') },
      { id: 'receipt.pledge', title: 'Nantir le récépissé', description: 'Bloque vente, transfert et sortie physique.', personas: 'Propriétaire du récépissé', method: 'POST', path: (_v, r) => `/v1/warehouse-receipts/${pathRef(r, 'receiptId')}/pledge`, fields: [text('pledgeeOrganizationId', 'Organisation créancière'), text('pledgeReference', 'Référence du nantissement')], body: (v) => ({ pledgeeOrganizationId: required(v.pledgeeOrganizationId, 'Créancier'), pledgeReference: required(v.pledgeReference, 'Référence') }), etag: (r) => required(r.receiptEtag, 'ETag récépissé'), capture: capture('receiptId', 'receiptEtag') },
      { id: 'receipt.releasePledge', title: 'Lever le nantissement', description: 'Libère le récépissé après règlement de la garantie.', personas: 'Créancier, Négociant, Acheteur ou Admin', method: 'POST', path: (_v, r) => `/v1/warehouse-receipts/${pathRef(r, 'receiptId')}/release-pledge`, fields: [text('reason', 'Motif')], body: (v) => ({ reason: required(v.reason, 'Motif') }), etag: (r) => required(r.receiptEtag, 'ETag récépissé'), capture: capture('receiptId', 'receiptEtag') },
      { id: 'receipt.transfer', title: 'Transférer le récépissé', description: 'Change le propriétaire économique du stock.', personas: 'Propriétaire ou mandataire', method: 'POST', path: (_v, r) => `/v1/warehouse-receipts/${pathRef(r, 'receiptId')}/transfer`, fields: [text('newOwnerOrganizationId', 'Nouvelle organisation propriétaire')], body: (v) => ({ newOwnerOrganizationId: required(v.newOwnerOrganizationId, 'Nouveau propriétaire') }), etag: (r) => required(r.receiptEtag, 'ETag récépissé'), capture: capture('receiptId', 'receiptEtag') },
      { id: 'receipt.release', title: 'Libérer le stock', description: 'Confirme la sortie physique du lot.', personas: "Opérateur d'entrepôt gardien", method: 'POST', path: (_v, r) => `/v1/warehouse-receipts/${pathRef(r, 'receiptId')}/release`, etag: (r) => required(r.receiptEtag, 'ETag récépissé'), capture: capture('receiptId', 'receiptEtag') },
    ],
  },
  {
    id: 'trading', label: 'Négociation', description: 'Offres, cotations, confirmation et règlement sécurisé.', commands: [
      { id: 'rfq.create', title: 'Créer une offre de vente', description: 'Réserve le lot et invite des organisations acheteuses.', personas: 'Vendeur ou mandataire', method: 'POST', path: () => '/v1/trading/rfqs', fields: [text('buyerOrganizationIds', 'Acheteurs, séparés par virgule'), { key: 'expiresAt', label: 'Clôture', type: 'datetime', required: true, initial: () => localDateTime(new Date(Date.now() + 86_400_000)) }], body: (v, r) => ({ lotId: required(r.lotId, 'Lot'), invitedBuyerOrganizationIds: csv(v.buyerOrganizationIds), expiresAt: new Date(required(v.expiresAt, 'Clôture')).toISOString() }), capture: capture('rfqId', 'rfqEtag') },
      { id: 'rfq.get', title: "Actualiser l'offre", description: 'Recharge les cotations et la confirmation éventuelle.', personas: 'Vendeur, acheteur invité, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/trading/rfqs/${pathRef(r, 'rfqId')}`, capture: (data) => { const value = object(data); const rfq = object(value.rfq); const trade = value.trade ? object(value.trade) : undefined; const quotes = Array.isArray(value.quotes) ? value.quotes : []; return { rfqId: String(rfq.id ?? ''), rfqEtag: String(rfq.etag ?? ''), ...(trade ? { tradeId: String(trade.id ?? '') } : {}), ...(quotes[0] ? { quoteId: String(object(quotes[0]).id ?? '') } : {}) } } },
      { id: 'rfq.quote', title: 'Déposer une cotation', description: 'Propose un prix unitaire en XOF.', personas: 'Acheteur invité, Négociant ou Courtier', method: 'POST', path: (_v, r) => `/v1/trading/rfqs/${pathRef(r, 'rfqId')}/quotes`, fields: [number('unitPriceMinor', 'Prix unitaire XOF', '800')], body: (v) => ({ unitPriceMinor: integer(v, 'unitPriceMinor') }), capture: (data) => ({ quoteId: String(object(data).id ?? '') }) },
      { id: 'rfq.accept', title: 'Accepter la cotation', description: 'Confirme la transaction et marque le lot vendu.', personas: 'Vendeur', method: 'POST', path: (_v, r) => `/v1/trading/rfqs/${pathRef(r, 'rfqId')}/accept`, body: (_v, r) => ({ quoteId: required(r.quoteId, 'Cotation') }), etag: (r) => required(r.rfqEtag, 'ETag offre'), capture: (data) => { const value = object(data); const rfq = object(value.rfq); const trade = object(value.trade); return { rfqId: String(rfq.id ?? ''), rfqEtag: String(rfq.etag ?? ''), tradeId: String(trade.id ?? '') } } },
      { id: 'rfq.cancel', title: "Annuler l'offre", description: 'Rend le lot disponible avant confirmation.', personas: 'Vendeur', method: 'POST', path: (_v, r) => `/v1/trading/rfqs/${pathRef(r, 'rfqId')}/cancel`, fields: [text('reason', 'Motif')], body: (v) => ({ reason: required(v.reason, 'Motif') }), etag: (r) => required(r.rfqEtag, 'ETag offre'), capture: capture('rfqId', 'rfqEtag') },
      { id: 'settlement.create', title: 'Ouvrir le règlement', description: "Crée l'instruction de financement déterministe.", personas: 'Acheteur de la transaction', method: 'POST', path: () => '/v1/settlements', body: (_v, r) => ({ rfqId: required(r.rfqId, 'Offre'), tradeId: required(r.tradeId, 'Transaction') }), capture: capture('settlementId', 'settlementEtag') },
      { id: 'settlement.get', title: 'Actualiser le règlement', description: 'Affiche instruction, rapprochement et grand livre.', personas: 'Vendeur, acheteur, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/settlements/${pathRef(r, 'settlementId')}`, capture: (data) => { const settlement = entity(data, 'settlement'); return { settlementId: String(settlement.id ?? ''), settlementEtag: String(settlement.etag ?? '') } } },
      { id: 'settlement.callback', title: 'Notifier le prestataire escrow', description: 'Traite un événement externe signé: financement, libération ou remboursement.', personas: 'Prestataire externe avec signature HMAC', method: 'POST', path: () => '/v1/settlements/provider-events/callback', fields: [text('eventId', 'Identifiant événement', () => `EVT-${Date.now()}`), select('type', 'Type', ['FUNDED', 'RELEASED', 'REFUNDED'], 'FUNDED'), text('providerReference', 'Référence prestataire'), text('signature', 'Signature HMAC'), optional('occurredAt', 'Horodatage ISO', () => new Date().toISOString())], body: (v, r) => ({ eventId: required(v.eventId, 'Événement'), settlementId: required(r.settlementId, 'Règlement'), type: v.type, providerReference: required(v.providerReference, 'Référence'), occurredAt: required(v.occurredAt, 'Horodatage') }), headers: (v) => ({ 'x-escrow-signature': required(v.signature, 'Signature') }), capture: capture('settlementId', 'settlementEtag') },
      { id: 'settlement.release', title: 'Demander la libération', description: 'Place un règlement financé en attente de libération.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/settlements/${pathRef(r, 'settlementId')}/request-release`, etag: (r) => required(r.settlementEtag, 'ETag règlement'), capture: capture('settlementId', 'settlementEtag') },
      { id: 'settlement.refund', title: 'Demander le remboursement', description: 'Place un règlement financé en attente de remboursement.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/settlements/${pathRef(r, 'settlementId')}/request-refund`, etag: (r) => required(r.settlementEtag, 'ETag règlement'), capture: capture('settlementId', 'settlementEtag') },
    ],
  },
  {
    id: 'fulfillment', label: 'Livraison & litiges', description: 'Affectation logistique, preuve de livraison et résolution.', commands: [
      { id: 'delivery.create', title: 'Créer la livraison', description: 'Affecte une organisation et un utilisateur logistique après financement.', personas: 'Vendeur ou acheteur', method: 'POST', path: () => '/v1/deliveries', fields: [text('logisticsOrganizationId', 'Organisation logistique', ref('logisticsOrganizationId')), text('assignedLogisticsUserId', 'Utilisateur logistique', 'driver-1')], body: (v, r) => ({ rfqId: required(r.rfqId, 'Offre'), tradeId: required(r.tradeId, 'Transaction'), logisticsOrganizationId: required(v.logisticsOrganizationId, 'Organisation logistique'), assignedLogisticsUserId: required(v.assignedLogisticsUserId, 'Utilisateur logistique') }), capture: capture('deliveryId', 'deliveryEtag') },
      { id: 'delivery.get', title: 'Actualiser la livraison', description: 'Recharge le jalon et la preuve courante.', personas: 'Parties, utilisateur logistique, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/deliveries/${pathRef(r, 'deliveryId')}`, capture: capture('deliveryId', 'deliveryEtag') },
      ...(['pickedUp', 'inTransit', 'arrived'] as const).map((status) => ({ id: `delivery.${status}`, title: status === 'pickedUp' ? 'Confirmer le retrait' : status === 'inTransit' ? 'Confirmer le transit' : "Confirmer l'arrivée", description: `Passe la livraison au jalon ${status}.`, personas: 'Utilisateur logistique assigné', method: 'POST' as const, path: (_v: Values, r: Refs) => `/v1/deliveries/${pathRef(r, 'deliveryId')}/milestones/${status}`, fields: [optional('temperatureMilliC', 'Température milli-°C'), optional('oxygenMilliPercent', 'Oxygène milli-%'), optional('location', 'Position'), optional('notes', 'Notes')], body: (v: Values) => evidence(v), etag: (r: Refs) => required(r.deliveryEtag, 'ETag livraison'), capture: capture('deliveryId', 'deliveryEtag') })),
      { id: 'delivery.pod', title: 'Soumettre la preuve', description: 'Enregistre le destinataire et la preuve de livraison.', personas: 'Utilisateur logistique assigné', method: 'POST', path: (_v, r) => `/v1/deliveries/${pathRef(r, 'deliveryId')}/pod`, fields: [text('recipientName', 'Destinataire'), text('evidenceReference', 'Référence de preuve'), optional('temperatureMilliC', 'Température milli-°C'), optional('oxygenMilliPercent', 'Oxygène milli-%'), optional('location', 'Position'), optional('notes', 'Notes')], body: (v) => ({ recipientName: required(v.recipientName, 'Destinataire'), evidenceReference: required(v.evidenceReference, 'Preuve'), ...evidence(v) }), etag: (r) => required(r.deliveryEtag, 'ETag livraison'), capture: capture('deliveryId', 'deliveryEtag') },
      { id: 'delivery.decision', title: 'Décider la réception', description: 'Accepte, rejette ou place partiellement la livraison en litige.', personas: 'Acheteur', method: 'POST', path: (_v, r) => `/v1/deliveries/${pathRef(r, 'deliveryId')}/decision`, fields: [...quantityFields('accepted'), ...quantityFields('rejected'), optional('rejectionReason', 'Motif du rejet')], body: (v) => ({ acceptedQuantity: quantity(v, 'accepted'), rejectedQuantity: quantity(v, 'rejected'), ...(maybe(v.rejectionReason) ? { rejectionReason: v.rejectionReason.trim() } : {}) }), etag: (r) => required(r.deliveryEtag, 'ETag livraison'), capture: capture('deliveryId', 'deliveryEtag') },
      { id: 'dispute.create', title: 'Ouvrir un litige', description: 'Conteste une réception partielle ou rejetée dans les sept jours.', personas: 'Vendeur ou acheteur', method: 'POST', path: () => '/v1/disputes', fields: [text('reasonCode', 'Code motif', 'PARTIAL_QUALITY_REJECTION'), { ...text('description', 'Description'), type: 'textarea' }, text('evidenceReferences', 'Preuves, séparées par virgule')], body: (v, r) => ({ deliveryId: required(r.deliveryId, 'Livraison'), reasonCode: required(v.reasonCode, 'Motif'), description: required(v.description, 'Description'), evidenceReferences: csv(v.evidenceReferences) }), capture: capture('disputeId', 'disputeEtag') },
      { id: 'dispute.get', title: 'Actualiser le litige', description: 'Recharge dossier, preuves et réponses.', personas: 'Parties, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/disputes/${pathRef(r, 'disputeId')}`, capture: (data) => { const dispute = entity(data, 'dispute'); return { disputeId: String(dispute.id ?? ''), disputeEtag: String(dispute.etag ?? '') } } },
      { id: 'dispute.evidence', title: 'Ajouter une preuve', description: 'Verse un élément au dossier.', personas: 'Vendeur ou acheteur', method: 'POST', path: (_v, r) => `/v1/disputes/${pathRef(r, 'disputeId')}/evidence`, fields: [text('evidenceReference', 'Référence de preuve'), { ...text('description', 'Description'), type: 'textarea' }], body: (v) => ({ evidenceReference: required(v.evidenceReference, 'Preuve'), description: required(v.description, 'Description') }) },
      { id: 'dispute.response', title: 'Répondre au litige', description: 'Ajoute une position de partie et ses pièces.', personas: 'Vendeur ou acheteur', method: 'POST', path: (_v, r) => `/v1/disputes/${pathRef(r, 'disputeId')}/responses`, fields: [{ ...text('message', 'Réponse'), type: 'textarea' }, optional('evidenceReferences', 'Preuves, séparées par virgule')], body: (v) => ({ message: required(v.message, 'Réponse'), evidenceReferences: maybe(v.evidenceReferences) ? csv(v.evidenceReferences) : [] }) },
      { id: 'dispute.mediate', title: 'Démarrer la médiation', description: 'Prend en charge le dossier pour décision.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/disputes/${pathRef(r, 'disputeId')}/start-mediation`, etag: (r) => required(r.disputeEtag, 'ETag litige'), capture: capture('disputeId', 'disputeEtag') },
      { id: 'dispute.decide', title: 'Décider le litige', description: 'Ordonne la libération ou le remboursement du règlement.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/disputes/${pathRef(r, 'disputeId')}/decide`, fields: [select('remedy', 'Remède', ['release', 'refund'], 'release'), { ...text('rationale', 'Motivation'), type: 'textarea' }], body: (v) => ({ remedy: v.remedy, rationale: required(v.rationale, 'Motivation') }), etag: (r) => required(r.disputeEtag, 'ETag litige'), capture: capture('disputeId', 'disputeEtag') },
    ],
  },
  {
    id: 'compliance', label: 'Conformité & risque', description: 'Documents, rappels, restrictions, limites et alertes.', commands: [
      { id: 'document.create', title: 'Soumettre un document', description: 'Dépose une pièce de conformité datée.', personas: 'Organisation participante', method: 'POST', path: () => '/v1/compliance/documents', fields: [text('type', 'Type', 'AGRICULTURAL_LICENSE'), text('documentReference', 'Référence document'), text('evidenceReference', 'Référence preuve'), { key: 'issuedAt', label: "Date d'émission", type: 'date', required: true }, { key: 'validUntil', label: "Date d'expiration", type: 'date', required: true }], body: (v, r) => ({ organizationId: required(r.organizationId, 'Organisation'), type: required(v.type, 'Type'), documentReference: required(v.documentReference, 'Référence'), evidenceReference: required(v.evidenceReference, 'Preuve'), issuedAt: required(v.issuedAt, 'Émission'), validUntil: required(v.validUntil, 'Expiration') }), capture: capture('documentId', 'documentEtag') },
      { id: 'document.list', title: 'Lister les documents', description: 'Affiche les pièces et leur statut effectif.', personas: 'Organisation, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/compliance/organizations/${pathRef(r, 'organizationId')}/documents`, capture: captureListFirst('documentId', 'documentEtag') },
      { id: 'document.review', title: 'Examiner un document', description: 'Approuve ou rejette une pièce soumise.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/compliance/organizations/${pathRef(r, 'organizationId')}/documents/${pathRef(r, 'documentId')}/review`, fields: [select('status', 'Décision', ['approved', 'rejected'], 'approved'), text('reason', 'Motif')], body: (v) => ({ status: v.status, reason: required(v.reason, 'Motif') }), etag: (r) => required(r.documentEtag, 'ETag document'), capture: capture('documentId', 'documentEtag') },
      { id: 'recall.create', title: 'Appliquer un rappel', description: 'Met en quarantaine le lot racine et ses descendants.', personas: 'Admin ou Régulateur', method: 'POST', path: () => '/v1/compliance/recalls', fields: [text('reference', 'Référence rappel', () => `RCL-${Date.now()}`), text('reason', 'Motif')], body: (v, r) => ({ reference: required(v.reference, 'Référence'), rootLotId: required(r.lotId, 'Lot'), reason: required(v.reason, 'Motif') }), capture: (data) => { const recall = entity(data, 'recall'); return { recallId: String(recall.id ?? ''), recallEtag: String(recall.etag ?? '') } } },
      { id: 'recall.get', title: 'Actualiser le rappel', description: "Affiche l'impact du rappel sur les lots.", personas: 'Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/compliance/recalls/${pathRef(r, 'recallId')}`, capture: (data) => { const recall = entity(data, 'recall'); return { recallId: String(recall.id ?? ''), recallEtag: String(recall.etag ?? '') } } },
      { id: 'recall.release', title: 'Lever le rappel', description: 'Libère uniquement les quarantaines liées à ce rappel.', personas: 'Admin ou Régulateur', method: 'POST', path: (_v, r) => `/v1/compliance/recalls/${pathRef(r, 'recallId')}/release`, etag: (r) => required(r.recallEtag, 'ETag rappel'), capture: (data) => { const recall = entity(data, 'recall'); return { recallId: String(recall.id ?? ''), recallEtag: String(recall.etag ?? '') } } },
      { id: 'restriction.create', title: 'Créer une restriction', description: 'Bloque les mouvements sur une région et éventuellement un produit.', personas: 'Admin ou Régulateur', method: 'POST', path: () => '/v1/compliance/movement-restrictions', fields: [text('reference', 'Référence', () => `MOV-${Date.now()}`), text('regionCode', 'Code région', 'ABIDJAN'), optional('commodityCode', 'Code produit'), text('reason', 'Motif'), text('effectiveFrom', 'Début ISO', () => new Date().toISOString()), optional('effectiveUntil', 'Fin ISO')], body: (v) => withOptional({ reference: required(v.reference, 'Référence'), regionCode: required(v.regionCode, 'Région'), reason: required(v.reason, 'Motif'), effectiveFrom: required(v.effectiveFrom, 'Début') }, v, ['commodityCode', 'effectiveUntil']), capture: capture('restrictionId', 'restrictionEtag') },
      { id: 'restriction.list', title: 'Lister les restrictions', description: 'Affiche les mesures régionales actives et historiques.', personas: 'Tout participant authentifié', method: 'GET', path: (v) => `/v1/compliance/movement-restrictions/${encodeURIComponent(required(v.regionCode, 'Région'))}`, fields: [text('regionCode', 'Code région', 'ABIDJAN')], capture: captureListFirst('restrictionId', 'restrictionEtag') },
      { id: 'restriction.release', title: 'Lever la restriction', description: 'Clôt la mesure régionale ciblée.', personas: 'Admin ou Régulateur', method: 'POST', path: (v, r) => `/v1/compliance/movement-restrictions/${encodeURIComponent(required(v.regionCode, 'Région'))}/${pathRef(r, 'restrictionId')}/release`, fields: [text('regionCode', 'Code région', 'ABIDJAN')], etag: (r) => required(r.restrictionEtag, 'ETag restriction'), capture: capture('restrictionId', 'restrictionEtag') },
      { id: 'risk.limits.put', title: 'Configurer les limites', description: "Définit la transaction maximale et l'exposition livraison.", personas: 'Administration', method: 'PUT', path: (_v, r) => `/v1/risk/organizations/${pathRef(r, 'organizationId')}/limits`, fields: [number('maxTradeValueMinor', 'Transaction maximale XOF', '10000000'), number('maxOpenDeliveryExposureMinor', 'Exposition maximale XOF', '25000000')], body: (v) => ({ maxTradeValueMinor: integer(v, 'maxTradeValueMinor'), maxOpenDeliveryExposureMinor: integer(v, 'maxOpenDeliveryExposureMinor') }), etag: (r) => r.riskLimitsEtag ?? '', capture: capture('organizationId', 'riskLimitsEtag') },
      { id: 'risk.limits.get', title: 'Consulter les limites', description: 'Recharge les seuils de risque.', personas: 'Organisation, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/risk/organizations/${pathRef(r, 'organizationId')}/limits`, capture: capture('organizationId', 'riskLimitsEtag') },
      { id: 'risk.alerts', title: 'Lister les alertes', description: 'Affiche les dépassements, conditions et échéances.', personas: 'Organisation, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/risk/organizations/${pathRef(r, 'organizationId')}/alerts`, capture: captureListFirst('alertId', 'alertEtag') },
      { id: 'risk.ack', title: 'Accuser réception', description: 'Marque une alerte ouverte comme prise en compte.', personas: 'Organisation concernée', method: 'POST', path: (_v, r) => `/v1/risk/organizations/${pathRef(r, 'organizationId')}/alerts/${pathRef(r, 'alertId')}/acknowledge`, etag: (r) => required(r.alertEtag, 'ETag alerte'), capture: capture('alertId', 'alertEtag') },
      { id: 'risk.resolve', title: 'Résoudre une alerte', description: 'Clôt administrativement une alerte.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/risk/organizations/${pathRef(r, 'organizationId')}/alerts/${pathRef(r, 'alertId')}/resolve`, fields: [text('resolution', 'Résolution')], body: (v) => ({ resolution: required(v.resolution, 'Résolution') }), etag: (r) => required(r.alertEtag, 'ETag alerte'), capture: capture('alertId', 'alertEtag') },
      { id: 'risk.scan', title: 'Scanner les échéances', description: 'Crée les alertes pour documents bientôt expirés.', personas: 'Administration', method: 'POST', path: (_v, r) => `/v1/risk/organizations/${pathRef(r, 'organizationId')}/scan-compliance`, fields: [number('warningDays', "Jours d'anticipation", '30')], body: (v) => ({ warningDays: integer(v, 'warningDays') }), capture: captureListFirst('alertId', 'alertEtag') },
    ],
  },
  {
    id: 'oversight', label: 'Pilotage', description: 'Rapports, audit, webhooks et flux événementiels.', commands: [
      { id: 'report.summary', title: "Rapport d'organisation", description: 'Agrège stock, échanges, règlements, livraisons et risques.', personas: 'Organisation, Admin ou Régulateur', method: 'GET', path: (_v, r) => `/v1/reports/organizations/${pathRef(r, 'organizationId')}/summary` },
      { id: 'audit.list', title: "Journal d'audit", description: 'Liste les événements consolidés de tous les agrégats.', personas: 'Organisation, Admin ou Régulateur', method: 'GET', path: (v, r) => `/v1/audit/events?organizationId=${encodeURIComponent(r.organizationId ?? '')}&limit=${encodeURIComponent(v.limit ?? '100')}`, fields: [number('limit', 'Nombre maximum', '100')] },
      { id: 'webhook.create', title: 'Créer un webhook', description: 'Abonne une URL HTTPS publique aux événements.', personas: 'Participant authentifié', method: 'POST', path: () => '/v1/integrations/webhooks', fields: [text('endpoint', 'URL HTTPS'), text('topics', 'Sujets, séparés par virgule', 'private.trade.executed')], body: (v) => ({ endpoint: required(v.endpoint, 'URL'), topics: csv(v.topics) }), capture: (data) => { const subscription = entity(data, 'subscription'); return { webhookId: String(subscription.id ?? ''), signingSecret: String(object(data).signingSecret ?? '') } } },
      { id: 'webhook.list', title: 'Lister les webhooks', description: 'Affiche les abonnements de la portée courante.', personas: 'Participant authentifié', method: 'GET', path: () => '/v1/integrations/webhooks', capture: captureListFirst('webhookId', 'webhookEtag') },
      { id: 'attempt.list', title: 'Lister les livraisons webhook', description: 'Affiche succès, reprises et lettres mortes.', personas: "Propriétaire de l'abonnement", method: 'GET', path: () => '/v1/integrations/webhook-attempts', capture: captureListFirst('attemptId', 'attemptEtag') },
      { id: 'attempt.dispatch', title: 'Distribuer une tentative', description: "Déclenche l'appel HTTPS lorsqu'il est dû.", personas: "Propriétaire de l'abonnement", method: 'POST', path: (_v, r) => `/v1/integrations/webhook-attempts/${pathRef(r, 'attemptId')}/dispatch` },
      { id: 'attempt.replay', title: 'Rejouer une tentative', description: 'Replace une tentative en attente.', personas: "Propriétaire de l'abonnement", method: 'POST', path: (_v, r) => `/v1/integrations/webhook-attempts/${pathRef(r, 'attemptId')}/replay` },
      { id: 'events.private', title: 'Flux privé', description: "Liste les événements de l'organisation.", personas: 'Organisation participante', method: 'GET', path: () => '/v1/integrations/events/private?limit=100' },
      { id: 'events.public', title: 'Flux public', description: 'Liste les événements publics séquencés.', personas: 'Public', method: 'GET', path: () => '/v1/integrations/events/public?limit=100' },
      { id: 'events.publish', title: 'Publier un événement', description: 'Crée un événement et ses tentatives webhook.', personas: 'Administration', method: 'POST', path: () => '/v1/integrations/events', fields: [select('topic', 'Sujet', ['public.market.snapshot', 'private.trade.executed', 'private.settlement.updated', 'private.delivery.updated', 'private.risk.alert'], 'public.market.snapshot'), text('subjectId', 'Sujet métier'), optional('payload', 'Charge JSON', '{}')], body: (v, r) => ({ topic: v.topic, ...(v.topic.startsWith('private.') ? { organizationId: required(r.organizationId, 'Organisation') } : {}), subjectId: required(v.subjectId, 'Sujet'), payload: parseJson(v.payload) }) },
    ],
  },
]

const REF_LABELS: Record<string, string> = {
  organizationId: 'Organisation', warehouseOrganizationId: 'Entrepôt', logisticsOrganizationId: 'Logistique', productionUnitId: 'Unité', lotId: 'Lot', inspectionId: 'Inspection', receiptId: 'Récépissé', rfqId: 'Offre', quoteId: 'Cotation', tradeId: 'Transaction', settlementId: 'Règlement', deliveryId: 'Livraison', disputeId: 'Litige', documentId: 'Document', recallId: 'Rappel', restrictionId: 'Restriction', alertId: 'Alerte', webhookId: 'Webhook', attemptId: 'Tentative',
}

export function OperationsWorkspace({ identity, commodities, onChanged, onOrganizationCreated }: { identity: Identity; commodities: Commodity[]; onChanged: () => void; onOrganizationCreated: (organizationId: string) => void }) {
  const [groupId, setGroupId] = useState(GROUPS[0].id)
  const group = GROUPS.find((item) => item.id === groupId) ?? GROUPS[0]
  const [commandId, setCommandId] = useState(group.commands[0].id)
  const command = GROUPS.flatMap((item) => item.commands).find((item) => item.id === commandId) ?? group.commands[0]
  const [refs, setRefs] = useState<Refs>(() => loadRefs(identity.organizationId))
  const [values, setValues] = useState<Values>({})
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [showRefs, setShowRefs] = useState(false)

  useEffect(() => {
    if (identity.organizationId) setRefs((current) => ({ ...current, organizationId: identity.organizationId }))
  }, [identity.organizationId])

  useEffect(() => {
    localStorage.setItem('bordchamp.lifecycle.refs', JSON.stringify(refs))
  }, [refs])

  const initializeCommand = useEffectEvent(() => {
    const next: Values = {}
    for (const field of command.fields ?? []) next[field.key] = typeof field.initial === 'function' ? field.initial(refs) : field.initial ?? ''
    const defaultCommodity = commodities.find((commodity) => commodity.code === 'TOMATO') ?? commodities[0]
    if (command.id === 'lot.create' && defaultCommodity) {
      next.commodityCode = defaultCommodity.code
      next.category = defaultCommodity.category
    }
    setValues(next); setResult(null); setError('')
  })

  useEffect(() => {
    initializeCommand()
  }, [command, commodities])

  function chooseGroup(next: Group) { setGroupId(next.id); setCommandId(next.commands[0].id) }

  async function execute(event: React.FormEvent) {
    event.preventDefault(); setRunning(true); setError('')
    try {
      const headers = new Headers(command.headers?.(values))
      const etag = command.etag?.(refs)
      if (etag) headers.set('if-match', etag)
      const data = await api<unknown>(command.path(values, refs), identity, { method: command.method, headers, ...(command.body ? { body: JSON.stringify(command.body(values, refs)) } : {}) })
      const captured = command.capture?.(data) ?? {}
      if (Object.keys(captured).length) setRefs((current) => ({ ...current, ...cleanRefs(captured) }))
      if (command.id === 'organization.create' && captured.organizationId) onOrganizationCreated(captured.organizationId)
      setResult(data); onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Échec de la commande') }
    finally { setRunning(false) }
  }

  return <div className="operations-layout">
    <section className="lifecycle-head">
      <div><span className="eyebrow">Cycle opérationnel complet</span><h2>Piloter du producteur au règlement</h2><p>Les références et ETags capturés sont réutilisés automatiquement à chaque étape.</p></div>
      <button className="secondary-button" type="button" onClick={() => setShowRefs((value) => !value)}>{showRefs ? 'Masquer' : 'Gérer'} les références</button>
    </section>

    {showRefs && <ReferenceLedger refs={refs} onChange={setRefs} />}

    <div className="lifecycle-tabs" role="tablist" aria-label="Étapes du cycle">
      {GROUPS.map((item, index) => <button className={item.id === group.id ? 'is-active' : ''} type="button" role="tab" aria-selected={item.id === group.id} key={item.id} onClick={() => chooseGroup(item)}><span>{index + 1}</span>{item.label}</button>)}
    </div>

    <section className="operation-stage">
      <aside className="command-list"><header><h3>{group.label}</h3><p>{group.description}</p></header>{group.commands.map((item) => <button className={item.id === command.id ? 'is-active' : ''} type="button" key={item.id} onClick={() => setCommandId(item.id)}><strong>{item.title}</strong><small>{item.personas}</small></button>)}</aside>
      <div className="command-workbench">
        <header><div><span className="method-badge">{command.method}</span><h3>{command.title}</h3><p>{command.description}</p></div><span className="persona-hint">{command.personas}</span></header>
        <form onSubmit={(event) => void execute(event)}>
          {(command.fields ?? []).length > 0 ? <div className="command-fields">{command.fields?.map((field) => <CommandField field={field} value={values[field.key] ?? ''} key={field.key} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />)}</div> : <div className="command-ready"><span>✓</span><div><strong>Références prêtes</strong><p>Cette commande utilise les identifiants mémorisés dans le dossier courant.</p></div></div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="command-submit"><button className="primary-button" disabled={running} type="submit">{running ? 'Exécution…' : 'Exécuter la commande'}</button><code>{safePath(command, values, refs)}</code></div>
        </form>
        {result !== null && <section className="operation-result"><header><strong>Résultat</strong><button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(result, null, 2))}>Copier</button></header><pre>{JSON.stringify(result, null, 2)}</pre></section>}
      </div>
    </section>
  </div>
}

function CommandField({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  return <label className={field.type === 'textarea' ? 'is-wide' : ''}><span>{field.label}{field.required && <b>*</b>}</span>{field.type === 'select' ? <select required={field.required} value={value} onChange={(event) => onChange(event.target.value)}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'textarea' ? <textarea required={field.required} value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} /> : <input required={field.required} type={field.type ?? 'text'} value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />}</label>
}

function ReferenceLedger({ refs, onChange }: { refs: Refs; onChange: (refs: Refs) => void }) {
  return <section className="reference-ledger"><header><div><span className="eyebrow">Dossier courant</span><h3>Identifiants de workflow</h3></div><button type="button" onClick={() => onChange(refs.organizationId ? { organizationId: refs.organizationId } : {})}>Réinitialiser</button></header><div>{Object.entries(REF_LABELS).map(([key, label]) => <label key={key}><span>{label}</span><input value={refs[key] ?? ''} onChange={(event) => onChange({ ...refs, [key]: event.target.value })} /></label>)}</div></section>
}

function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function evidence(values: Values) { const output: Record<string, unknown> = {}; for (const key of ['temperatureMilliC', 'oxygenMilliPercent']) if (maybe(values[key])) output[key] = integer(values, key); for (const key of ['location', 'notes']) if (maybe(values[key])) output[key] = values[key]?.trim(); return output }
function parseJson(value: string | undefined) { try { return JSON.parse(value || '{}') as unknown } catch { throw new Error('La charge JSON est invalide') } }
function cleanRefs(refs: Refs) { return Object.fromEntries(Object.entries(refs).filter(([, value]) => value)) }
function loadRefs(organizationId: string) { try { const saved = JSON.parse(localStorage.getItem('bordchamp.lifecycle.refs') ?? '{}') as Refs; return { ...saved, ...(organizationId ? { organizationId } : {}) } } catch { return organizationId ? { organizationId } : {} } }
function localDateTime(value: Date) { const offset = value.getTimezoneOffset() * 60_000; return new Date(value.getTime() - offset).toISOString().slice(0, 16) }
function safePath(command: Command, values: Values, refs: Refs) { try { return command.path(values, refs) } catch { return 'Références requises non renseignées' } }