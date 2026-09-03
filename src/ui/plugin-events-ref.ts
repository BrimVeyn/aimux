/**
 * How aimux's own UI tells plugins that something happened.
 *
 * The daemon bridges its event vocabulary onto the kernel bus at startup
 * (`DAEMON_EVENT_NAMES`), because everything it emits is already routed through
 * one place. The UI has no such place: a git poll, a theme swap and a pane
 * opening are three unrelated call sites, none of which should have to know
 * that a plugin kernel exists — let alone import it.
 *
 * So the host publishes one emitter here, the way it already publishes
 * `dispatchGlobal` and the side-effect runner, and a call site emits without
 * knowing whether anything is listening. Before the host mounts — in the CLI,
 * in the daemon, in a unit test — this is a no-op rather than an error.
 */

type Emitter = (event: string, payload: unknown) => void

let emit: Emitter | null = null

export function setUiPluginEmitter(fn: Emitter | null): void {
  emit = fn
}

export function emitUiPluginEvent(event: string, payload: unknown): void {
  emit?.(event, payload)
}
