import { lcsDiff } from './lcs'
import { type Unit, unitKey, unitWords } from './units'

export type BlockEntry =
  | { new: Unit; old: Unit; type: 'modified' }
  | { new: Unit; old: Unit; type: 'same' }
  | { new: Unit; type: 'added' }
  | { old: Unit; type: 'removed' }

// Below this, a removed unit and an added one are a replacement, not an edit:
// highlighting the few words they share would say they are related when they
// are not.
const MIN_SIMILARITY = 0.35

/** Dice coefficient over the two units' word multisets. */
export function similarity(a: Unit, b: Unit): number {
  const wa = unitWords(a)
  const wb = unitWords(b)
  if (wa.length === 0 && wb.length === 0) return 1
  const counts = new Map<string, number>()
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of wb) {
    const c = counts.get(w) ?? 0
    if (c > 0) {
      shared++
      counts.set(w, c - 1)
    }
  }
  return (2 * shared) / (wa.length + wb.length)
}

function pairable(a: Unit, b: Unit): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'heading' && b.kind === 'heading' && a.depth !== b.depth) return false
  return similarity(a, b) >= MIN_SIMILARITY
}

/**
 * Within one changed run, pairs each removed unit with the next added unit it
 * resembles, keeping both sides in order. Unpaired removals land just before the
 * addition that follows them on the old side.
 */
function pairRun(removed: Unit[], added: Unit[], out: BlockEntry[]): void {
  const pairOf = new Map<number, number>()
  let nextAdded = 0
  for (let r = 0; r < removed.length; r++) {
    const old = removed[r] as Unit
    for (let a = nextAdded; a < added.length; a++) {
      if (pairable(old, added[a] as Unit)) {
        pairOf.set(a, r)
        nextAdded = a + 1
        break
      }
    }
  }
  // Removals go out ahead of the additions, as in a line diff, but never past the
  // next pair: what was removed before a modified unit stays before it.
  const pairedFrom = (a: number): number => {
    for (let k = a; k < added.length; k++) {
      const r = pairOf.get(k)
      if (r !== undefined) return r
    }
    return removed.length
  }
  let nextRemoved = 0
  // The kind of the unit last put out on the new side, within this run.
  let lastKind: Unit['kind'] | null = null
  for (let a = 0; a < added.length; a++) {
    const unit = added[a] as Unit
    const r = pairOf.get(a)
    // An addition that carries on what was just put out (one more list item
    // after an edited one) stays with it, ahead of removals that follow.
    if (r !== undefined || unit.kind !== lastKind) {
      for (const until = pairedFrom(a); nextRemoved < until; nextRemoved++) {
        out.push({ old: removed[nextRemoved] as Unit, type: 'removed' })
      }
    }
    if (r !== undefined) {
      out.push({ new: unit, old: removed[r] as Unit, type: 'modified' })
      nextRemoved = r + 1
    } else {
      out.push({ new: unit, type: 'added' })
    }
    lastKind = unit.kind
  }
  for (; nextRemoved < removed.length; nextRemoved++) {
    out.push({ old: removed[nextRemoved] as Unit, type: 'removed' })
  }
}

export function diffUnits(before: readonly Unit[], after: readonly Unit[]): BlockEntry[] {
  const out: BlockEntry[] = []
  let removed: Unit[] = []
  let added: Unit[] = []
  const flush = (): void => {
    if (removed.length > 0 || added.length > 0) pairRun(removed, added, out)
    removed = []
    added = []
  }
  for (const op of lcsDiff(before, after, unitKey)) {
    if (op.type === 'same') {
      flush()
      out.push({ new: op.b, old: op.a, type: 'same' })
    } else if (op.type === 'del') {
      removed.push(op.a)
    } else {
      added.push(op.b)
    }
  }
  flush()
  return out
}
