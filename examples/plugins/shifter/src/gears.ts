/**
 * The gears, shared by both halves.
 *
 * A plugin's two halves are two processes and share no memory, but they can
 * share a *module*: the bundler pulls this file into each one. Constants and
 * pure functions belong here; anything with state does not.
 */

export interface Gear {
  /** 1-5, and the number the tile shows. */
  index: number
  label: string
  /** Config key holding the line to type. */
  configKey: string
}

const FIRST: Gear = { configKey: 'gear1', index: 1, label: 'haiku' }

export const GEARS: readonly Gear[] = [
  FIRST,
  { configKey: 'gear2', index: 2, label: 'sonnet' },
  { configKey: 'gear3', index: 3, label: 'opus' },
  { configKey: 'gear4', index: 4, label: 'fable' },
  { configKey: 'gear5', index: 5, label: 'fable+' },
]

/** Clamps rather than wraps: a gearbox does not go from fifth to first. */
export function shift(current: number, delta: number): number {
  return Math.min(GEARS.length, Math.max(1, current + delta))
}

export function gearAt(index: number): Gear {
  return GEARS[index - 1] ?? FIRST
}

/** What to type for a gear, or null when the config emptied it out. */
export function commandFor(config: Record<string, unknown>, index: number): string | null {
  const value = config[gearAt(index).configKey]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}
