import type { MeasuredPaneRect } from './use-pane-size-report'

// `onMeasure` reaches TerminalPane as a prop chain from app.tsx through
// root.tsx. A widget hosting its own PTY sits in the bar tree, which that chain
// never touches — same problem `dispatchGlobal` solves for actions, same shape
// of answer. Going straight to backend.resizeTab instead would mean
// re-implementing the PTY_MIN clamps and the per-tab dedupe that handleMeasure
// owns, and a mismatch there makes the resize loop never settle.
type MeasureFn = (tabId: string, rect: MeasuredPaneRect) => void

let activeMeasure: MeasureFn | null = null

export function setActiveMeasure(measure: MeasureFn | null): void {
  activeMeasure = measure
}

export function measureGlobal(tabId: string, rect: MeasuredPaneRect): void {
  activeMeasure?.(tabId, rect)
}
