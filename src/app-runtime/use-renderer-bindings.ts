import { useRenderer } from '@opentui/react'
import { type MutableRefObject, useEffect, useRef } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type { AppAction, FocusMode, TabSession } from '../state/types'

import { INPUT_DEBUG_LOG_PATH, logInputDebug } from '../debug/input-log'
import { createRawInputHandler } from '../input/raw-input-handler'
import { copyToSystemClipboard } from '../platform/clipboard'
import { writePasteToTab, writeToTab } from './pty-write'
import { type OtuiSelection, resolveSelectionClipboardText } from './selection-clipboard'
import { applyViewportObservation, type ViewportObservation } from './selection-scroll'

const BRACKETED_PASTE_ENABLE_SEQUENCE = '\x1b[?2004h'
const BRACKETED_PASTE_DISABLE_SEQUENCE = '\x1b[?2004l'
const PASTE_DEBUG_PREVIEW_LENGTH = 120
const TEXT_DECODER = new TextDecoder()

interface UseRendererBindingsOptions {
  backend: SessionBackend
  renderer: ReturnType<typeof useRenderer>
  dispatch: (action: AppAction) => void
  focusMode: FocusMode
  activeTabId: string | null
  activeTabViewportY: number | null
  focusModeRef: MutableRefObject<FocusMode>
  activeTabIdRef: MutableRefObject<string | null>
  activeTabRef: MutableRefObject<TabSession | undefined>
}

function decodeBytes(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes)
}

export function useRendererBindings({
  activeTabId,
  activeTabIdRef,
  activeTabRef,
  activeTabViewportY,
  backend,
  dispatch,
  focusMode,
  focusModeRef,
  renderer,
}: UseRendererBindingsOptions): void {
  const lastViewportRef = useRef<ViewportObservation | null>(null)

  useEffect(() => {
    renderer.useMouse = true
    renderer.useConsole = false
    renderer.console.hide()
    renderer.console.show = () => {}

    const handler = createRawInputHandler({
      enterLayoutMode: () => dispatch({ focusMode: 'layout', type: 'set-focus-mode' }),
      getActiveTabId: () => activeTabIdRef.current,
      getBracketedPasteModeEnabled: () =>
        activeTabRef.current?.terminalModes.bracketedPasteMode ?? false,
      getFocusMode: () => focusModeRef.current,
      leaveTerminalInput: () => dispatch({ focusMode: 'navigation', type: 'set-focus-mode' }),
      toggleSidebar: () => dispatch({ type: 'toggle-sidebar' }),
      writeToPty: (tabId, data) => writeToTab(backend, tabId, activeTabRef.current, data),
    })

    const handlePasteEvent = (event: { bytes: Uint8Array; defaultPrevented?: boolean }) => {
      logInputDebug('app.rendererPaste', {
        byteLength: event.bytes.length,
        defaultPrevented: event.defaultPrevented ?? false,
      })

      if (event.defaultPrevented) {
        return
      }

      const tab = activeTabRef.current
      const tabId = activeTabIdRef.current
      const currentFocusMode = focusModeRef.current
      const payload = decodeBytes(event.bytes)

      logInputDebug('app.onTerminalPaste', {
        activeTabId: tabId,
        bracketedPasteMode: tab?.terminalModes.bracketedPasteMode ?? false,
        byteLength: event.bytes.length,
        decodedPreview: payload.slice(0, PASTE_DEBUG_PREVIEW_LENGTH),
        focusMode: currentFocusMode,
      })

      if (currentFocusMode === 'command-edit') {
        const sanitized = payload.replace(/\r\n?/g, '\n')
        dispatch({ char: sanitized, type: 'update-command-edit' })
        return
      }

      if (currentFocusMode !== 'terminal-input' || !tabId || !tab) {
        return
      }

      writePasteToTab(backend, tabId, tab, payload)
    }

    const handleSelection = (selection: OtuiSelection) => {
      const { fallbackLength, selectedText, streamLength } = resolveSelectionClipboardText(
        selection,
        activeTabRef.current
      )

      logInputDebug('app.selection', {
        fallbackLength,
        isDragging: selection.isDragging ?? false,
        osc52Supported: renderer.isOsc52Supported(),
        streamLength,
        textLength: selectedText.length,
      })

      if (selection.isDragging || selectedText.length === 0) {
        return
      }

      renderer.copyToClipboardOSC52(selectedText)
      copyToSystemClipboard(selectedText)
    }

    renderer.prependInputHandler(handler)
    renderer.keyInput.on('paste', handlePasteEvent)
    renderer.on('selection', handleSelection)

    return () => {
      renderer.removeInputHandler(handler)
      renderer.keyInput.off('paste', handlePasteEvent)
      renderer.off('selection', handleSelection)
    }
  }, [activeTabIdRef, activeTabRef, backend, dispatch, focusModeRef, renderer])

  useEffect(() => {
    const next: ViewportObservation | null =
      activeTabId !== null && activeTabViewportY !== null
        ? { tabId: activeTabId, y: activeTabViewportY }
        : null
    lastViewportRef.current = applyViewportObservation(renderer, lastViewportRef.current, next)
  }, [activeTabId, activeTabViewportY, renderer])

  useEffect(() => {
    const shouldEnableBracketedPaste = focusMode === 'terminal-input' && activeTabId !== null
    logInputDebug('app.bracketedPasteMode', {
      activeTabId,
      enabled: shouldEnableBracketedPaste,
      focusMode,
      logPath: INPUT_DEBUG_LOG_PATH,
    })
    process.stdout.write(
      shouldEnableBracketedPaste
        ? BRACKETED_PASTE_ENABLE_SEQUENCE
        : BRACKETED_PASTE_DISABLE_SEQUENCE
    )

    return () => {
      process.stdout.write(BRACKETED_PASTE_DISABLE_SEQUENCE)
    }
  }, [activeTabId, focusMode])
}
