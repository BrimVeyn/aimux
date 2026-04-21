/**
 * Module-level flag that mirrors `autoCommit.enabled` from the resolved config.
 *
 * Actions (which run outside React and can't subscribe to a React context) read
 * this via `isAutoCommitEnabled()`. The app sets it once at startup via
 * `setAutoCommitEnabled(resolvedConfig.autoCommit.enabled)` before any children
 * render, so downstream readers always see the correct value.
 */

let enabled = false

export function setAutoCommitEnabled(value: boolean): void {
  enabled = value
}

export function isAutoCommitEnabled(): boolean {
  return enabled
}
