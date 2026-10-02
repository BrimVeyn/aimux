/**
 * Both versions of a file, rebuilt from a unified diff fetched with full context
 * (`--unified=99999`): every line of the file is in the patch, as kept, removed
 * or added. A new file is all additions and a deleted one all removals, so the
 * same walk covers them.
 */
export function splitUnifiedDiff(raw: string): { after: string; before: string } {
  const before: string[] = []
  const after: string[] = []
  let inHunk = false
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    const mark = line[0]
    const text = line.slice(1)
    if (mark === ' ') {
      before.push(text)
      after.push(text)
    } else if (mark === '-') {
      before.push(text)
    } else if (mark === '+') {
      after.push(text)
    } else if (mark === 'd' && line.startsWith('diff --git')) {
      // A second file in the same patch: not ours.
      break
    }
    // `\ No newline at end of file` and the trailing empty split: nothing to keep.
  }
  return { after: after.join('\n'), before: before.join('\n') }
}
