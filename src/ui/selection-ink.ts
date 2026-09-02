import { useBaseTheme } from './theme'

/**
 * The one legible colour on a selected list row.
 *
 * A selected row is filled with `primary`, so everything drawn on it has to read
 * against that rather than against the modal behind it — the page background
 * does, which is the same trick the status bar's accent tiles already use for
 * their mode and version badges. Every tone the caller would otherwise use on
 * that row (muted subtitle, warning mark, accent badge) collapses to this one:
 * a fill that strong leaves room for exactly one ink.
 *
 * Always the opaque base, never the live theme. In transparent mode
 * `t.background` resolves to 'transparent' and the text would be painted away,
 * while the fill itself stays opaque — `primary` is not one of the chrome
 * background tokens the transparent overlay rewrites.
 */
export function useSelectionInk(): string {
  return useBaseTheme().background
}
