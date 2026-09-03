/**
 * The sample both halves talk about, and the drawing that turns a series of
 * them into something a person can read.
 *
 * Shared by the two halves the same way `gears.ts` is in the shifter: a module,
 * not memory. Nothing here holds state or touches the machine.
 */

export interface Sample {
  /** 0-1, or null when the source did not answer. */
  cpu: number | null
  gpu: number | null
  at: number
}

/** How many samples the UI keeps. One screen's worth of a narrow bar. */
export const HISTORY = 60

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/**
 * A series as one line of block characters, right-aligned so the newest sample
 * is always at the same place — a graph whose "now" moves is a graph nobody can
 * read at a glance.
 */
export function sparkline(values: readonly (number | null)[], width: number): string {
  if (width <= 0) return ''
  const window = values.slice(-width)
  const pad = ' '.repeat(Math.max(0, width - window.length))
  const line = window
    .map((value) => {
      if (value === null) return ' '
      const index = Math.min(
        BLOCKS.length - 1,
        Math.max(0, Math.round(value * (BLOCKS.length - 1)))
      )
      return BLOCKS[index] ?? ' '
    })
    .join('')
  return `${pad}${line}`
}

/** `0.42` → `42%`, and `null` → `—`. */
export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}
