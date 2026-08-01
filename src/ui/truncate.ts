/** Fit a label into `max` columns, marking the cut with an ellipsis. */
export function truncate(label: string, max: number): string {
  if (max <= 0) return ''
  if (label.length <= max) return label
  if (max === 1) return '…'
  return `${label.slice(0, max - 1)}…`
}

/**
 * Same, but cutting from the front. For labels whose meaning is at the end —
 * a branch is `nathan/feat/dictation-fix`, and `nathan/feat/dicta…` names the
 * author twice and the work not at all, where `…/dictation-fix` names the work.
 */
export function truncateStart(label: string, max: number): string {
  if (max <= 0) return ''
  if (label.length <= max) return label
  if (max === 1) return '…'
  return `…${label.slice(label.length - (max - 1))}`
}
