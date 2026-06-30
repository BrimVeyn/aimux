export interface FlashTarget {
  /** Stable identity (used by callers to pair labels back with their target). */
  key: string
  /** Display name used to pick a nice first-letter label when possible. */
  name: string
}

export interface AssignedLabel {
  key: string
  label: string
}

/**
 * Pool of letters used as labels — home row first (easiest to reach), then the
 * rest of the alphabet. Lowercase a–z only; the flash-jump mode handler relies
 * on letter input being lowercase ASCII.
 */
const POOL: string[] = [
  'a',
  's',
  'd',
  'f',
  'g',
  'h',
  'j',
  'k',
  'l',
  'q',
  'w',
  'e',
  'r',
  't',
  'y',
  'u',
  'i',
  'o',
  'p',
  'z',
  'x',
  'c',
  'v',
  'b',
  'n',
  'm',
]

/**
 * Extract the first lowercase alphanumeric letter of a name (for the
 * "prefer the actual first letter" heuristic). Returns null when the name has
 * no usable character.
 */
function firstAlphaLetter(name: string): string | null {
  for (const raw of name) {
    const ch = raw.toLowerCase()
    if (ch >= 'a' && ch <= 'z') return ch
  }
  return null
}

/**
 * Assign 1- or 2-char labels to a list of targets in display order.
 *
 * Algorithm:
 * - Up to (POOL.length - reserved) targets get 1-char labels. We try to give
 *   each target its real first letter when it's still free; otherwise pull
 *   from the pool.
 * - If the list overflows the single-char budget, the last pool letter is
 *   reserved as a 2-char prefix and the overflow gets `<prefix><letter>`
 *   labels (also drawn from POOL).
 * - When a target's preferred first letter is needed as the 2-char prefix
 *   (or already taken), we fall back to the next available pool letter.
 *
 * The function never returns colliding labels and never returns a label
 * `xy` whose prefix `x` is also a 1-char label — letting the input handler
 * resolve on each keystroke unambiguously.
 */
export function assignFlashLabels(targets: FlashTarget[]): AssignedLabel[] {
  if (targets.length === 0) return []

  const singleBudget = targets.length <= POOL.length ? POOL.length : POOL.length - 1
  const needsPrefix = targets.length > POOL.length
  const prefixLetter = needsPrefix ? (POOL.at(-1) ?? null) : null
  const singlePool = needsPrefix ? POOL.slice(0, POOL.length - 1) : [...POOL]

  const used = new Set<string>()
  const result: AssignedLabel[] = []

  const singleSlice = targets.slice(0, singleBudget)
  for (const target of singleSlice) {
    const preferred = firstAlphaLetter(target.name)
    if (preferred !== null && preferred !== prefixLetter && !used.has(preferred)) {
      used.add(preferred)
      result.push({ key: target.key, label: preferred })
      continue
    }
    const next = singlePool.find((letter) => !used.has(letter))
    if (next === undefined) {
      // Single-letter pool exhausted — push remaining targets to the 2-char
      // overflow path below.
      result.push({ key: target.key, label: '' })
      continue
    }
    used.add(next)
    result.push({ key: target.key, label: next })
  }

  if (!needsPrefix) {
    return result.filter((entry) => entry.label !== '')
  }

  const prefix = prefixLetter as string
  const overflow = targets.slice(singleBudget)
  const usedSecondary = new Set<string>()
  for (const target of overflow) {
    const preferred = firstAlphaLetter(target.name)
    const second =
      preferred !== null && !usedSecondary.has(preferred)
        ? preferred
        : (POOL.find((letter) => !usedSecondary.has(letter)) ?? null)
    if (second === null) break
    usedSecondary.add(second)
    result.push({ key: target.key, label: `${prefix}${second}` })
  }

  return result.filter((entry) => entry.label !== '')
}
