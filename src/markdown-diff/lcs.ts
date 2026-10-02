export type LcsOp<T> = { type: 'same'; a: T; b: T } | { type: 'del'; a: T } | { type: 'add'; b: T }

/**
 * Edit script between two sequences, by longest common subsequence on `key`.
 *
 * Common prefix and suffix are peeled off first: a document edit touches a few
 * blocks in the middle, so the quadratic table only ever spans the part that
 * moved. Deletions come before additions within a changed run.
 */
export function lcsDiff<T>(a: readonly T[], b: readonly T[], key: (x: T) => string): LcsOp<T>[] {
  const ka = a.map(key)
  const kb = b.map(key)
  let start = 0
  while (start < a.length && start < b.length && ka[start] === kb[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--
    endB--
  }

  const out: LcsOp<T>[] = []
  for (let i = 0; i < start; i++) out.push({ a: a[i] as T, b: b[i] as T, type: 'same' })

  const n = endA - start
  const m = endB - start
  // lengths[i][j] = LCS of a[start+i..endA) and b[start+j..endB), flattened.
  const width = m + 1
  const lengths = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        ka[start + i] === kb[start + j]
          ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0)
    }
  }
  let i = 0
  let j = 0
  const dels: LcsOp<T>[] = []
  const adds: LcsOp<T>[] = []
  const flush = (): void => {
    out.push(...dels, ...adds)
    dels.length = 0
    adds.length = 0
  }
  while (i < n || j < m) {
    if (i < n && j < m && ka[start + i] === kb[start + j]) {
      flush()
      out.push({ a: a[start + i] as T, b: b[start + j] as T, type: 'same' })
      i++
      j++
    } else if (
      j >= m ||
      (i < n && (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0))
    ) {
      dels.push({ a: a[start + i] as T, type: 'del' })
      i++
    } else {
      adds.push({ b: b[start + j] as T, type: 'add' })
      j++
    }
  }
  flush()

  for (let k = 0; k < a.length - endA; k++) {
    out.push({ a: a[endA + k] as T, b: b[endB + k] as T, type: 'same' })
  }
  return out
}
