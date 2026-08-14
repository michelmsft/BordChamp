import { useEffect, useId, useRef } from 'react'
import type { FormEvent, ReactNode } from 'react'

interface DrawerProps {
  title: string
  detail?: string
  onClose: () => void
  onSubmit?: (event: FormEvent) => void
  children: ReactNode
  actions?: ReactNode
  closeLabel?: string
  size?: 'md' | 'lg' | 'xl'
}

export function Drawer({ title, detail, onClose, onSubmit, children, actions, closeLabel = 'Fermer', size = 'md' }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
  }, [])

  const inner = (
    <>
      <header>
        <div>
          <h2 id={titleId}>{title}</h2>
          {detail && <p>{detail}</p>}
        </div>
        <button type="button" className="icon-button" title={closeLabel} aria-label={closeLabel} onClick={onClose}>×</button>
      </header>
      <div className="drawer-body">{children}</div>
      {actions && <div className="drawer-actions">{actions}</div>}
    </>
  )

  return (
    <>
      <div className="drawer-backdrop" role="presentation" onMouseDown={onClose} />
      <section ref={panelRef} className={`drawer is-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {onSubmit ? <form onSubmit={onSubmit}>{inner}</form> : <div className="drawer-inner">{inner}</div>}
      </section>
    </>
  )
}
