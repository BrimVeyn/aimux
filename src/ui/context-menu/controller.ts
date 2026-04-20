export type ContextMenuItem = [label: string, onSelect: () => void]

export interface ContextMenuState {
  anchorX: number
  anchorY: number
  items: ContextMenuItem[]
}

type Listener = (state: ContextMenuState | null) => void

let current: ContextMenuState | null = null
const listeners = new Set<Listener>()

export function openContextMenu(anchorX: number, anchorY: number, items: ContextMenuItem[]): void {
  if (items.length === 0) {
    closeContextMenu()
    return
  }
  current = { anchorX, anchorY, items }
  for (const l of listeners) l(current)
}

export function closeContextMenu(): void {
  if (current === null) return
  current = null
  for (const l of listeners) l(null)
}

export function subscribeContextMenu(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
