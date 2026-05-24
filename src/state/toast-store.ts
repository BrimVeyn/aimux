import type { ReactNode } from 'react'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { createPrefixedId } from '../platform/id'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'
export type ToastPosition = `${'top' | 'bottom'}-${'left' | 'center' | 'right'}`

export interface ToastOptions {
  title?: string
  message?: string
  /** Custom body — rendered inside the toast shell instead of title/message. */
  content?: ReactNode
  variant?: ToastVariant
  /** Auto-dismiss after this many ms; 0 keeps it until dismissed. */
  durationMs?: number
  position?: ToastPosition
}

export interface Toast {
  id: string
  createdAt: number
  content?: ReactNode
  durationMs: number
  message?: string
  position: ToastPosition
  title?: string
  variant: ToastVariant
}

export const TOAST_CONFIG = {
  defaultPosition: 'top-right' as ToastPosition,
  // Default auto-dismiss per variant when `durationMs` isn't given. Errors (and
  // warnings) linger longer than confirmations so they're not missed.
  durations: { error: 7000, info: 3500, success: 3500, warning: 5000 } as Record<
    ToastVariant,
    number
  >,
  gap: 1,
  /** Most recent toasts kept visible per position; older ones are evicted. */
  maxVisible: 4,
  /** Instant (no slide) — set in tests or for reduced motion. */
  reduceMotion: false,
  width: 40,
}

interface ToastStoreState {
  toasts: Toast[]
  show: (opts: ToastOptions) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const toastStore = createStore<ToastStoreState>((set) => ({
  clear: () => set({ toasts: [] }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) })),
  show: (opts) => {
    const id = createPrefixedId('toast')
    const variant = opts.variant ?? 'info'
    const next: Toast = {
      content: opts.content,
      createdAt: Date.now(),
      durationMs: opts.durationMs ?? TOAST_CONFIG.durations[variant],
      id,
      message: opts.message,
      position: opts.position ?? TOAST_CONFIG.defaultPosition,
      title: opts.title,
      variant,
    }
    set((state) => ({ toasts: [...state.toasts, next] }))
    return id
  },
  toasts: [],
}))

export function useToastStore<T>(selector: (state: ToastStoreState) => T): T {
  return useStore(toastStore, selector)
}

function variantShortcut(variant: ToastVariant) {
  return (message: string, opts: Omit<ToastOptions, 'message' | 'variant'> = {}): string =>
    toastStore.getState().show({ ...opts, message, variant })
}

// Imperative API usable anywhere (components, side effects) without React.
export const toast = {
  dismiss: (id: string) => toastStore.getState().dismiss(id),
  error: variantShortcut('error'),
  info: variantShortcut('info'),
  show: (opts: ToastOptions) => toastStore.getState().show(opts),
  success: variantShortcut('success'),
  warning: variantShortcut('warning'),
}
