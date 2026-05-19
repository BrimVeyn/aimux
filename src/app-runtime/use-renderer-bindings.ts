import { useRenderer } from '@opentui/react'
import { type MutableRefObject, useEffect, useRef } from 'react'

import type { KeyChord } from '../input/keymap/key-chord'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction, FocusMode, SnippetRecord, TabSession } from '../state/types'

import { INPUT_DEBUG_LOG_PATH, logInputDebug } from '../debug/input-log'
import { createRawInputHandler } from '../input/raw-input-handler'
import { copyToSystemClipboard, readFromSystemClipboard } from '../platform/clipboard'
import {
  contentNeedsClipboard,
  expandSnippet,
  expandSnippetSync,
} from '../snippets/expand-variables'
import {
  createTriggerDetector,
  type TriggerDetector,
  type TriggerMatch,
} from '../snippets/trigger-detector'
import { shouldSuppressSelectionCopy } from './multi-click-clipboard-guard'
import { writeMacroExpansionToTab, writePasteToTab, writeToTab } from './pty-write'
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
  snippetsRef: MutableRefObject<readonly SnippetRecord[]>
  branchRef: MutableRefObject<string | null>
  triggerCharRef: MutableRefObject<string>
  handleTerminalShortcut: (chord: KeyChord) => boolean
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
  branchRef,
  dispatch,
  focusMode,
  focusModeRef,
  handleTerminalShortcut,
  renderer,
  snippetsRef,
  triggerCharRef,
}: UseRendererBindingsOptions): void {
  const lastViewportRef = useRef<ViewportObservation | null>(null)
  const triggerDetectorsRef = useRef<Map<string, TriggerDetector>>(new Map())

  useEffect(() => {
    renderer.useMouse = true
    renderer.consoleMode = 'disabled'
    renderer.console.hide()
    renderer.console.show = () => {}

    const getOrCreateDetector = (tabId: string): TriggerDetector => {
      let detector = triggerDetectorsRef.current.get(tabId)
      if (!detector) {
        detector = createTriggerDetector({
          getSnippets: () => snippetsRef.current,
          getTriggerChar: () => triggerCharRef.current,
        })
        triggerDetectorsRef.current.set(tabId, detector)
      }
      return detector
    }

    const expandMacroForTab = (tabId: string, match: TriggerMatch): void => {
      const tab = activeTabRef.current
      const content = match.snippet.content
      const branch = branchRef.current
      const cwd = process.cwd()
      const now = new Date()

      const performWrite = (text: string, cursorOffset: number) => {
        writeMacroExpansionToTab(
          backend,
          tabId,
          tab,
          match.triggerText.length,
          text,
          cursorOffset,
          dispatch
        )
      }

      if (contentNeedsClipboard(content)) {
        void expandSnippet(content, {
          branch,
          clipboard: readFromSystemClipboard,
          cwd,
          now,
        }).then(({ cursorOffset, text }) => performWrite(text, cursorOffset))
        return
      }

      const { cursorOffset, text } = expandSnippetSync(content, { branch, cwd, now })
      performWrite(text, cursorOffset)
    }

    const handler = createRawInputHandler({
      expandMacro: expandMacroForTab,
      feedTrigger: (tabId, char) => getOrCreateDetector(tabId).feed(char),
      getActiveTabId: () => activeTabIdRef.current,
      getBracketedPasteModeEnabled: () =>
        activeTabRef.current?.terminalModes.bracketedPasteMode ?? false,
      getFocusMode: () => focusModeRef.current,
      getIsAlternateBuffer: () => activeTabRef.current?.terminalModes.isAlternateBuffer ?? false,
      handleTerminalShortcut,
      resetTrigger: (tabId) => triggerDetectorsRef.current.get(tabId)?.reset(),
      writeToPty: (tabId, data, options) =>
        writeToTab(backend, tabId, activeTabRef.current, data, dispatch, options),
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

      writePasteToTab(backend, tabId, tab, payload, dispatch)
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

      // After a multi-click drag, handleTerminalMouseUp has just copied the
      // authoritative text built from drag.capturedLines (anchored at click
      // time). opentui's finishSelection() then re-fires this 'selection'
      // event, but the recomputed text can drift by a few rows when output
      // landed between mouseDown and mouseUp. Skip the redundant write.
      if (shouldSuppressSelectionCopy()) {
        logInputDebug('app.selection.suppressed', { textLength: selectedText.length })
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
  }, [
    activeTabIdRef,
    activeTabRef,
    backend,
    branchRef,
    dispatch,
    focusModeRef,
    handleTerminalShortcut,
    renderer,
    snippetsRef,
    triggerCharRef,
  ])

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
