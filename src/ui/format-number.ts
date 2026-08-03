/**
 * Token counts, short enough for a status bar and a stats table alike.
 *
 * One function rather than one per surface: the indicator and the usage modal
 * had drifted to `1.2k` and `1.2K` for the same number.
 */
export function formatCompact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}
