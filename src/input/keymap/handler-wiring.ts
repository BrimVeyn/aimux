import type { KeymapModeHandler } from './keymap-mode-handler'

/**
 * How a freshly built mode handler gets its timeout and pending-chord
 * callbacks.
 *
 * `app.tsx` wires those onto every handler `registerAllModes` returns, once,
 * at mount. A plugin can introduce a mode that did not exist then — the mode
 * of its own pane, typically — and a handler nobody wired swallows an
 * ambiguous prefix instead of resolving it when the timeout fires. So the app
 * publishes its wiring here, and whoever builds a handler later applies it.
 */

let wire: ((handler: KeymapModeHandler) => void) | null = null

export function setKeymapHandlerWiring(fn: (handler: KeymapModeHandler) => void): void {
  wire = fn
}

/** No-op before the app has mounted, which is the daemon and the CLI. */
export function wireKeymapHandler(handler: KeymapModeHandler): void {
  wire?.(handler)
}
