import { pluginStore } from '../plugins/plugin-store'
import { bumpRevision } from './settings-store'

const expanded = new Set<string>()

export function isExpanded(id: string): boolean {
  return expanded.has(id)
}

export function expandDrawer(id: string): void {
  if (expanded.has(id)) return
  expanded.add(id)
  bumpRevision()
}

export function toggleDrawer(id: string): void {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
  bumpRevision()
}

export function withAllExpanded<T>(fn: () => T): T {
  const before = new Set(expanded)
  for (const record of pluginStore.getState().records) expanded.add(record.id)
  try {
    return fn()
  } finally {
    expanded.clear()
    for (const id of before) expanded.add(id)
  }
}
