import type { SessionBackend } from '../session-backend/types'
import type { AppAction, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { buildPtyPastePayload } from '../input/paste'

export interface PtyWriteOptions {
  autoBottom?: boolean
}

function shouldScrollViewportToBottom(tab: TabSession): boolean {
  const viewport = tab.viewport
  return viewport !== undefined && viewport.viewportY < viewport.baseY
}

export function writeToTab(
  backend: SessionBackend,
  tabId: string,
  tab: TabSession | undefined,
  input: string,
  dispatch?: (action: AppAction) => void,
  options?: PtyWriteOptions
): void {
  logInputDebug('ptyWrite.writeToTab', {
    autoBottom: options?.autoBottom ?? true,
    inputLength: input.length,
    inputPreview: input.slice(0, 64),
    tabId,
  })
  if ((options?.autoBottom ?? true) && tab && shouldScrollViewportToBottom(tab)) {
    backend.scrollViewportToBottom(tabId)
    dispatch?.({ intent: { kind: 'bottom' }, tabId, type: 'set-scroll-intent' })
  }

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
  writeToTab(backend, tabId, tab, payload, dispatch, { autoBottom: true })
}

const DEL = '\x7f'
const CURSOR_LEFT = '\x1b[D'
const RAW_INLINE_MAX_LEN = 200

/**
 * Write a macro expansion to a PTY:
 *  1. Erase `eraseCount` previously echoed characters via DEL (readline-compatible).
 *  2. Inject `expandedText` (raw if short single-line; bracketed-paste payload otherwise).
 *  3. Move cursor left to `cursorOffset` via ANSI left-arrow sequences (outside any
 *     bracketed-paste wrapper so the application interprets them as keys, not text).
 */
export function writeMacroExpansionToTab(
  backend: SessionBackend,
  tabId: string,
  tab: TabSession | undefined,
  eraseCount: number,
  expandedText: string,
  cursorOffset: number,
  dispatch?: (action: AppAction) => void
): void {
  if (tab && shouldScrollViewportToBottom(tab)) {
    backend.scrollViewportToBottom(tabId)
    dispatch?.({ intent: { kind: 'bottom' }, tabId, type: 'set-scroll-intent' })
  }

  const erase = eraseCount > 0 ? DEL.repeat(eraseCount) : ''
  const isShortInline = expandedText.length <= RAW_INLINE_MAX_LEN && !expandedText.includes('\n')
  const bracketed = tab?.terminalModes.bracketedPasteMode ?? false

  const body = isShortInline ? expandedText : buildPtyPastePayload(expandedText, bracketed)
  const leftArrowCount = Math.max(0, expandedText.length - cursorOffset)
  const leftArrows = leftArrowCount > 0 ? CURSOR_LEFT.repeat(leftArrowCount) : ''

  logInputDebug('ptyWrite.macroExpansion', {
    bodyLength: body.length,
    cursorOffset,
    eraseCount,
    expandedTextLength: expandedText.length,
    leftArrowCount,
    tabId,
  })

  if (isShortInline) {
    backend.write(tabId, `${erase}${body}${leftArrows}`)
    return
  }

  if (erase) backend.write(tabId, erase)
  backend.write(tabId, body)
  if (leftArrows) backend.write(tabId, leftArrows)
}
