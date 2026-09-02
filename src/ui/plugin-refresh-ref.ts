/**
 * A way to say "re-read the plugins" from outside React.
 *
 * A settings row writes an override and then has to make it land — in this
 * process and in the daemon — but a row is a plain object built by a plain
 * function, with no access to the host's runtime or to the backend. Same
 * problem `src/state/dispatch-ref.ts` solves for actions, same shape of
 * answer: the host publishes the function on mount and takes it back on
 * unmount.
 *
 * A write with no host mounted still lands: the registry file is the durable
 * part, and the next launch reads it.
 */

export type PluginRefresh = () => void

let refresh: PluginRefresh | null = null

export function setPluginRefresh(next: PluginRefresh | null): void {
  refresh = next
}

/** Debounced by the caller, not here: this is the doorway, not the policy. */
export function refreshPluginsGlobal(): void {
  refresh?.()
}
