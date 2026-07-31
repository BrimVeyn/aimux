/** Fit a label into `max` columns, marking the cut with an ellipsis. */
export function truncate(label: string, max: number): string {
  if (max <= 0) return ''
  if (label.length <= max) return label
  if (max === 1) return '…'
  return `${label.slice(0, max - 1)}…`
}
