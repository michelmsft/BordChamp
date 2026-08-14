import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Language = 'fr' | 'en'

const STORAGE_KEY = 'bordchamp:lang'
const DEFAULT: Language = 'fr'

const dictionaries: Record<Language, Record<string, string>> = {
  fr: {
    'shell.eyebrow': 'Espace de négociation',
    'shell.refresh': 'Actualiser',
    'shell.newOffer': 'Nouvelle offre',
    'shell.status.live': 'Marché en direct',
    'shell.status.offline': 'API indisponible',
    'shell.lang.fr': 'FR',
    'shell.lang.en': 'EN',
    'shell.lang.switch': 'Changer la langue',
    'view.overview': "Vue d'ensemble",
    'view.erp': 'Gestion ERP',
    'view.operations': 'Console avancée',
    'view.market': 'Marché',
    'view.activity': 'Activité',
    'view.settings': 'Paramètres',
    'units.new': 'Nouvelle unité',
    'units.edit': 'Modifier l’unité',
    'units.duplicate': 'Dupliquer l’unité',
    'units.detail': 'Définissez le code, la dimension et l’échelle.',
    'units.field.code': 'Code',
    'units.field.labelFr': 'Libellé (fr)',
    'units.field.labelEn': 'Libellé (en)',
    'units.field.dimension': 'Dimension',
    'units.field.status': 'État',
    'units.field.baseUnit': 'Unité de base',
    'units.field.factor': 'Facteur vers base',
    'units.field.scale': 'Décimales',
    'units.field.optional': 'Optionnel',
    'units.delete.help': 'La suppression est impossible si cette unité est encore utilisée.',
    'units.delete.button': 'Supprimer l’unité',
    'units.delete.confirm': 'Supprimer définitivement l’unité {code} ?',
    'units.delete.keep': 'Conserver',
    'units.delete.doIt': 'Confirmer la suppression',
    'units.delete.busy': 'Suppression…',
    'units.selfBase': 'Une unité ne peut pas être sa propre unité de base.',
    'units.row.actions': 'Actions',
    'units.row.duplicate': 'Dupliquer',
    'units.row.delete': 'Supprimer',
    'units.toast.deleted': 'Unité supprimée',
    'units.toast.deletedDetail': 'L’unité {code} a été supprimée.',
    'units.toast.restored': 'Unité restaurée',
    'units.toast.restoreFailed': 'La restauration a échoué',
    'units.toast.undo': 'Annuler',
    'commodities.new': 'Créer un produit',
    'commodities.edit': 'Modifier le produit',
    'commodities.duplicate': 'Dupliquer le produit',
    'commodities.detail': "Configurez l'identité, la classification et les unités du produit.",
    'commodities.row.actions': 'Actions',
    'commodities.row.duplicate': 'Dupliquer',
    'commodities.row.suspend': 'Suspendre',
    'commodities.row.reactivate': 'Réactiver',
    'commodities.save': 'Enregistrer le produit',
    'commodities.create': 'Créer le produit',
    'commodities.toast.suspended': 'Produit suspendu',
    'commodities.toast.suspendedDetail': 'Le produit {code} n’est plus disponible.',
    'commodities.toast.reactivated': 'Produit réactivé',
    'commodities.toast.reactivatedDetail': 'Le produit {code} est de nouveau disponible.',
    'commodities.toast.updateFailed': 'La mise à jour a échoué',
    'schemes.new': 'Nouveau contrôle',
    'schemes.edit': 'Modifier le contrôle',
    'schemes.duplicate': 'Dupliquer le contrôle',
    'schemes.detail': "Définissez les critères d'inspection et les classes de qualité.",
    'schemes.duplicate.detail': 'Choisissez une nouvelle combinaison produit/type pour créer la copie.',
    'schemes.row.actions': 'Actions',
    'schemes.row.duplicate': 'Dupliquer',
    'schemes.row.suspend': 'Suspendre',
    'schemes.row.reactivate': 'Réactiver',
    'schemes.save': 'Enregistrer le contrôle',
    'schemes.create': 'Créer le contrôle',
    'schemes.createCopy': 'Créer la copie',
    'schemes.toast.suspended': 'Contrôle suspendu',
    'schemes.toast.suspendedDetail': 'Le contrôle {label} n’est plus actif.',
    'schemes.toast.reactivated': 'Contrôle réactivé',
    'schemes.toast.reactivatedDetail': 'Le contrôle {label} est de nouveau actif.',
    'schemes.toast.updateFailed': 'La mise à jour a échoué',
    'common.cancel': 'Annuler',
    'common.save': 'Enregistrer',
    'common.saving': 'Enregistrement…',
    'common.create': 'Créer',
    'common.close': 'Fermer',
  },
  en: {
    'shell.eyebrow': 'Trading workspace',
    'shell.refresh': 'Refresh',
    'shell.newOffer': 'New offer',
    'shell.status.live': 'Live market',
    'shell.status.offline': 'API unavailable',
    'shell.lang.fr': 'FR',
    'shell.lang.en': 'EN',
    'shell.lang.switch': 'Change language',
    'view.overview': 'Overview',
    'view.erp': 'ERP management',
    'view.operations': 'Advanced console',
    'view.market': 'Market',
    'view.activity': 'Activity',
    'view.settings': 'Settings',
    'units.new': 'New unit',
    'units.edit': 'Edit unit',
    'units.duplicate': 'Duplicate unit',
    'units.detail': 'Set the code, dimension, and scale.',
    'units.field.code': 'Code',
    'units.field.labelFr': 'Label (fr)',
    'units.field.labelEn': 'Label (en)',
    'units.field.dimension': 'Dimension',
    'units.field.status': 'Status',
    'units.field.baseUnit': 'Base unit',
    'units.field.factor': 'Factor to base',
    'units.field.scale': 'Decimals',
    'units.field.optional': 'Optional',
    'units.delete.help': 'Deletion is blocked while this unit is still in use.',
    'units.delete.button': 'Delete unit',
    'units.delete.confirm': 'Permanently delete unit {code}?',
    'units.delete.keep': 'Keep',
    'units.delete.doIt': 'Confirm deletion',
    'units.delete.busy': 'Deleting…',
    'units.selfBase': 'A unit cannot be its own base unit.',
    'units.row.actions': 'Actions',
    'units.row.duplicate': 'Duplicate',
    'units.row.delete': 'Delete',
    'units.toast.deleted': 'Unit deleted',
    'units.toast.deletedDetail': 'Unit {code} has been deleted.',
    'units.toast.restored': 'Unit restored',
    'units.toast.restoreFailed': 'Restore failed',
    'units.toast.undo': 'Undo',
    'commodities.new': 'Create product',
    'commodities.edit': 'Edit product',
    'commodities.duplicate': 'Duplicate product',
    'commodities.detail': 'Configure identity, classification, and units for the product.',
    'commodities.row.actions': 'Actions',
    'commodities.row.duplicate': 'Duplicate',
    'commodities.row.suspend': 'Suspend',
    'commodities.row.reactivate': 'Reactivate',
    'commodities.save': 'Save product',
    'commodities.create': 'Create product',
    'commodities.toast.suspended': 'Product suspended',
    'commodities.toast.suspendedDetail': 'Product {code} is no longer available.',
    'commodities.toast.reactivated': 'Product reactivated',
    'commodities.toast.reactivatedDetail': 'Product {code} is available again.',
    'commodities.toast.updateFailed': 'Update failed',
    'schemes.new': 'New control',
    'schemes.edit': 'Edit control',
    'schemes.duplicate': 'Duplicate control',
    'schemes.detail': 'Set the inspection metrics and quality classes.',
    'schemes.duplicate.detail': 'Pick a new product/type combination for the copy.',
    'schemes.row.actions': 'Actions',
    'schemes.row.duplicate': 'Duplicate',
    'schemes.row.suspend': 'Suspend',
    'schemes.row.reactivate': 'Reactivate',
    'schemes.save': 'Save control',
    'schemes.create': 'Create control',
    'schemes.createCopy': 'Create copy',
    'schemes.toast.suspended': 'Control suspended',
    'schemes.toast.suspendedDetail': 'Control {label} is no longer active.',
    'schemes.toast.reactivated': 'Control reactivated',
    'schemes.toast.reactivatedDetail': 'Control {label} is active again.',
    'schemes.toast.updateFailed': 'Update failed',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.saving': 'Saving…',
    'common.create': 'Create',
    'common.close': 'Close',
  },
}

interface LanguageContextValue {
  language: Language
  setLanguage: (next: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function resolveInitial(): Language {
  if (typeof window === 'undefined') return DEFAULT
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'fr' || stored === 'en') return stored
  return DEFAULT
}

function format(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return Object.entries(params).reduce((out, [key, value]) => out.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)), template)
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(resolveInitial)

  useEffect(() => {
    document.documentElement.lang = language
    window.localStorage.setItem(STORAGE_KEY, language)
  }, [language])

  const setLanguage = useCallback((next: Language) => setLanguageState(next), [])
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => format(dictionaries[language][key] ?? key, params),
    [language],
  )

  const value = useMemo<LanguageContextValue>(() => ({ language, setLanguage, t }), [language, setLanguage, t])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useT() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useT must be used within LanguageProvider')
  return context.t
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used within LanguageProvider')
  return { language: context.language, setLanguage: context.setLanguage }
}
