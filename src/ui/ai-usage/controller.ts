export interface AIUsagePopoverState {
  anchorX: number
  anchorY: number
}

type Listener = (state: AIUsagePopoverState | null) => void

let current: AIUsagePopoverState | null = null
const listeners = new Set<Listener>()

export function openAIUsagePopover(anchorX: number, anchorY: number): void {
  current = { anchorX, anchorY }
  for (const l of listeners) l(current)
}

export function closeAIUsagePopover(): void {
  if (current === null) return
  current = null
  for (const l of listeners) l(null)
}

export function toggleAIUsagePopover(anchorX: number, anchorY: number): void {
  if (current) {
    closeAIUsagePopover()
  } else {
    openAIUsagePopover(anchorX, anchorY)
  }
}

export function subscribeAIUsagePopover(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
