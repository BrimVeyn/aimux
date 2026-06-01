/**
 * Module-level singleton mirroring `statusBar.separator` from the resolved
 * config. The status bar component reads this each render; the app sets it
 * once at startup so the value is stable for the session.
 *
 * Same pattern as `auto-commit-runtime` / `external-editor-runtime` — avoids
 * threading config through React props or contexts.
 */

import type { StatusBarSeparator } from './types'

const DEFAULT_SEPARATOR: StatusBarSeparator = 'arrow'

let separator: StatusBarSeparator = DEFAULT_SEPARATOR

export function setStatusBarSeparator(value: StatusBarSeparator | undefined): void {
  separator = value ?? DEFAULT_SEPARATOR
}

export function getStatusBarSeparator(): StatusBarSeparator {
  return separator
}
