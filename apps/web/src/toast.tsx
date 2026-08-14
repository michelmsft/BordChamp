import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastAction {
  label: string
  onAct: () => void | Promise<void>
}

export interface ToastInput {
  tone?: ToastTone
  title: string
  detail?: string
  action?: ToastAction
  timeoutMs?: number
}

interface Toast {
  id: number
  tone: ToastTone
  title: string
  detail?: string
  action?: ToastAction
}

interface ToastContextValue {
  push: (input: ToastInput) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timeout = timers.current.get(id)
    if (timeout !== undefined) {
      window.clearTimeout(timeout)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++
      const toast: Toast = {
        id,
        tone: input.tone ?? 'info',
        title: input.title,
        detail: input.detail,
        action: input.action,
      }
      setToasts((current) => [...current, toast].slice(-5))
      const timeoutMs = input.timeoutMs ?? 6000
      if (timeoutMs > 0) {
        const handle = window.setTimeout(() => dismiss(id), timeoutMs)
        timers.current.set(id, handle)
      }
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => { for (const handle of map.values()) window.clearTimeout(handle) }
  }, [])

  const value = useMemo<ToastContextValue>(() => ({ push, dismiss }), [push, dismiss])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone} role="status">
            <div>
              <strong>{toast.title}</strong>
              {toast.detail && <small>{toast.detail}</small>}
            </div>
            {toast.action && (
              <button
                type="button"
                onClick={async () => {
                  const action = toast.action!
                  dismiss(toast.id)
                  await action.onAct()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider')
  return context
}
