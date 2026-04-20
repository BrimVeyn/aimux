import type { SessionBackend } from '../session-backend/types'
import type { TabSession } from '../state/types'

import { buildPtyPastePayload } from '../input/paste'

export function writeToTab(
  backend: SessionBackend,
  tabId: string,
  _tab: TabSession | undefined,
  input: string,
  _dispatch?: unknown
): void {
  backend.write(tabId, input)
}

export function writePasteToTab(
  backend: SessionBackend,
  tabId: string,
  tab: TabSession | undefined,
  text: string,
  dispatch?: (action: AppAction) => void
): void {
  const payload = buildPtyPastePayload(text, tab?.terminalModes.bracketedPasteMode ?? false)
  writeToTab(backend, tabId, tab, payload, dispatch)
}
