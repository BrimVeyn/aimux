import { useAppStore } from '../../state/app-store'

export interface FlashLabelView {
  /** Full label, e.g. "a" or "fk". */
  label: string
  /** Already-typed prefix length — the rendered label dims that segment. */
  matchedLen: number
  /** Suffix still to be typed. */
  remaining: string
  /** True when the current buffer still matches this label's prefix. */
  isActive: boolean
}

/**
 * Subscribe to the flash-jump modal and return label info for the row keyed
 * by `key` (e.g. `tab:<id>`, `ws:<id>`, `wt:<id>`). Returns null when the
 * modal isn't active or the row isn't a target.
 *
 * Selects primitives (label and buffer) separately so the snapshot React sees
 * stays referentially stable across renders. Returning a freshly-built object
 * from a single selector would tell useSyncExternalStore "state changed" on
 * every render and infinite-loop.
 */
export function useFlashLabel(key: string): FlashLabelView | null {
  const label = useAppStore((s) => {
    if (s.modal.type !== 'flash-jump') return null
    const entry = s.modal.labels.find((l) => l.key === key)
    return entry?.label ?? null
  })
  const buffer = useAppStore((s) => (s.modal.type === 'flash-jump' ? s.modal.buffer : ''))
  if (label === null) return null
  const isActive = label.startsWith(buffer)
  const matchedLen = isActive ? buffer.length : 0
  return {
    isActive,
    label,
    matchedLen,
    remaining: isActive ? label.slice(buffer.length) : label,
  }
}
