import type { useRenderer } from '@opentui/react'

import { type MutableRefObject, useEffect, useRef } from 'react'

import type { KeyChord } from '../input/keymap/key-chord'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction } from '../state/actions'
import type { FocusMode, SnippetRecord, TabSession } from '../state/types'

import { INPUT_DEBUG_LOG_PATH, logInputDebug } from '../debug/input-log'
import { createRawInputHandler } from '../input/raw-input-handler'
import { copyToSystemClipboard, readFromSystemClipboard } from '../platform/clipboard'
import {
  expandSnippet,
  expandSnippetSync,
  requiresAsyncExpansion,
} from '../snippets/expand-variables'
import { runShellVar } from '../snippets/run-shell-var'
import {
  createTriggerDetector,
  type TriggerDetector,
  type TriggerMatch,
} from '../snippets/trigger-detector'
import { shouldSuppressSelectionCopy } from './multi-click-clipboard-guard'
import { writeMacroExpansionToTab, writePasteToTab, writeToTab } from './pty-write'
import { type OtuiSelection, resolveSelectionClipboardText } from './selection-clipboard'
import {
  resetSelectionClipboardDedup,
  shouldWriteSelectionToClipboard,
} from './selection-clipboard-dedup'
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
  const pendingMacroUndoRef = useRef<Map<string, { fullLength: number; suffixLength: number }>>(
    new Map()
  )
  /**
   * Tabs currently waiting on an async expansion (shell vars or {{clipboard}}).
   * While a tab is in this set, new trigger detections on that tab are
   * suppressed — without this, a second trigger typed during the await would
   * race with the in-flight expansion and corrupt PTY state + undo bookkeeping.
   */
  const inFlightAsyncExpansionRef = useRef<Set<string>>(new Set())

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
      const snippet = match.snippet
      const branch = branchRef.current
      const cwd = process.cwd()
      const now = new Date()

      const registerUndo = (text: string, cursorOffset: number) => {
        // Undo window: only meaningful for short inline expansions where
        // cursor positions stay predictable in raw mode.
        if (!text.includes('\n')) {
          pendingMacroUndoRef.current.set(tabId, {
            fullLength: text.length,
            suffixLength: text.length - cursorOffset,
          })
        }
      }

      if (!requiresAsyncExpansion(snippet)) {
        const { cursorOffset, text } = expandSnippetSync(snippet.content, {
          branch,
          customVars: new Map(),
          cwd,
          now,
        })
        writeMacroExpansionToTab(backend, tabId, tab, match.triggerText.length, text, cursorOffset)
        registerUndo(text, cursorOffset)
        return
      }

      // Eager erase: drop the typed trigger from the PTY immediately so the
      // user doesn't stare at `:prfull ` while shell vars resolve.
      backend.write(tabId, '\x7f'.repeat(match.triggerText.length))
      inFlightAsyncExpansionRef.current.add(tabId)

      void (async () => {
        try {
          const varEntries = Object.entries(snippet.vars ?? {})
          const resolved = await Promise.all(
            varEntries.map(async ([name, v]) => [name, await runShellVar(name, v)] as const)
          )
          const customVars = new Map(resolved)
          const { cursorOffset, text } = await expandSnippet(snippet.content, {
            branch,
            clipboard: readFromSystemClipboard,
            customVars,
            cwd,
            now,
          })
          // Trigger already erased above; eraseCount = 0 here.
          writeMacroExpansionToTab(backend, tabId, tab, 0, text, cursorOffset)
          registerUndo(text, cursorOffset)
        } finally {
          inFlightAsyncExpansionRef.current.delete(tabId)
        }
      })()
    }

    const tryConsumeMacroUndo = (tabId: string, sequence: string): boolean => {
      const entry = pendingMacroUndoRef.current.get(tabId)
      if (!entry) return false
      pendingMacroUndoRef.current.delete(tabId)
      const isBackspace = sequence === '\x7f' || sequence === '\b'
      if (!isBackspace) return false
      const rightArrows = '\x1b[C'.repeat(entry.suffixLength)
      const dels = '\x7f'.repeat(entry.fullLength)
      backend.write(tabId, `${rightArrows}${dels}`)
      return true
    }

    const handler = createRawInputHandler({
      expandMacro: expandMacroForTab,
      feedTrigger: (tabId, char) => {
        // Drop new detections while an async expansion is in flight for this
        // tab — otherwise the second match races with the awaited write.
        if (inFlightAsyncExpansionRef.current.has(tabId)) {
          triggerDetectorsRef.current.get(tabId)?.reset()
          return null
        }
        return getOrCreateDetector(tabId).feed(char)
      },
      getActiveTabId: () => activeTabIdRef.current,
      getBracketedPasteModeEnabled: () =>
        activeTabRef.current?.terminalModes.bracketedPasteMode ?? false,
      getFocusMode: () => focusModeRef.current,
      getIsAlternateBuffer: () => activeTabRef.current?.terminalModes.isAlternateBuffer ?? false,
      handleTerminalShortcut,
      resetTrigger: (tabId) => triggerDetectorsRef.current.get(tabId)?.reset(),
      tryConsumeMacroUndo,
      writeToPty: (tabId, data, options) =>
        writeToTab(backend, tabId, activeTabRef.current, data, options),
    })

    const handlePasteEvent = (event: { bytes: Uint8Array; defaultPrevented?: boolean }) => {
      logInputDebug('app.rendererPaste', {
        byteLength: event.bytes.length,
        defaultPrevented: event.defaultPrevented ?? false,
      })

      if (event.defaultPrevented === true) {
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
        const sanitized = payload.replaceAll(/\r\n?/g, '\n')
        dispatch({ char: sanitized, type: 'update-command-edit' })
        return
      }

      if (currentFocusMode !== 'terminal-input' || tabId == null || tabId === '' || !tab) {
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

      if (selection.isDragging === true) {
        return
      }
      if (selectedText.length === 0) {
        // Deselect → forget the last-written text so a deliberate reselection
        // of the same text writes it again.
        resetSelectionClipboardDedup()
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
      if (shouldWriteSelectionToClipboard(selectedText)) {
        copyToSystemClipboard(selectedText)
      } else {
        logInputDebug('app.selection.dedup', { textLength: selectedText.length })
      }
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
