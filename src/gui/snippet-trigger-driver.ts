import type { SessionBackend } from '../session-backend/types'
import type { SnippetRecord, TabSession } from '../state/types'

import { writeMacroExpansionToTab } from '../app-runtime/pty-write'
import { logDebug } from '../debug/input-log'
import { readFromSystemClipboard } from '../platform/clipboard'
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

interface DriverOptions {
  backend: SessionBackend
  /** Current git branch for snippet `{{branch}}` expansion. Pass `null` when unknown. */
  getBranch: () => string | null
  getSnippets: () => readonly SnippetRecord[]
  /** The tab object for `tabId`, or undefined if none. Used for terminal-mode flags by writeMacroExpansionToTab. */
  getTab: (tabId: string) => TabSession | undefined
  getTriggerChar: () => string
}

export interface SnippetTriggerDriver {
  /** Drop per-tab state (call on tab close). */
  dispose: (tabId: string) => void
  /**
   * Feed a single character that was about to be written to a tab's PTY.
   * Returns true if the driver consumed the char (expansion in progress
   * or completed sync) — caller must NOT write the char to the PTY in that
   * case. Returns false to let the caller proceed with the raw write.
   */
  feedKey: (tabId: string, char: string) => boolean
  /** Reset the per-tab detector buffer (call on tab close or focus loss). */
  reset: (tabId: string) => void
  /**
   * If `sequence` is a backspace (\x7f or \b) AND a recent inline expansion
   * is pending undo on `tabId`, dispatch the undo sequence (cursor-right *
   * suffixLength + DEL * fullLength) to the backend and return true. The
   * undo entry is consumed (one-shot) regardless of whether `sequence` was
   * backspace, matching the TUI's tryConsumeMacroUndo semantics.
   * Returns false otherwise so the caller proceeds with the raw write.
   */
  tryConsumeUndo: (tabId: string, sequence: string) => boolean
}

export function createSnippetTriggerDriver(opts: DriverOptions): SnippetTriggerDriver {
  const detectors = new Map<string, TriggerDetector>()
  const inFlight = new Set<string>()
  const pendingUndo = new Map<string, { fullLength: number; suffixLength: number }>()

  const getOrCreateDetector = (tabId: string): TriggerDetector => {
    let detector = detectors.get(tabId)
    if (!detector) {
      detector = createTriggerDetector({
        getSnippets: opts.getSnippets,
        getTriggerChar: opts.getTriggerChar,
      })
      detectors.set(tabId, detector)
    }
    return detector
  }

  const registerUndo = (tabId: string, text: string, cursorOffset: number) => {
    // Undo window: only meaningful for short inline expansions where
    // cursor positions stay predictable in raw mode. Mirrors
    // src/app-runtime/use-renderer-bindings.ts:109.
    if (!text.includes('\n')) {
      pendingUndo.set(tabId, {
        fullLength: text.length,
        suffixLength: text.length - cursorOffset,
      })
    } else {
      // Any new expansion overwrites the previous undo entry — drop stale
      // state when the new expansion is multi-line and ineligible.
      pendingUndo.delete(tabId)
    }
  }

  const expandMacro = (tabId: string, match: TriggerMatch): void => {
    const tab = opts.getTab(tabId)
    const snippet = match.snippet
    const branch = opts.getBranch()
    const cwd = process.cwd()
    const now = new Date()

    if (!requiresAsyncExpansion(snippet)) {
      const { cursorOffset, text } = expandSnippetSync(snippet.content, {
        branch,
        customVars: new Map(),
        cwd,
        now,
      })
      logDebug('gui.host.snippetTrigger.expandSync', {
        snippetName: snippet.name,
        tabId,
        triggerLength: match.triggerText.length,
      })
      writeMacroExpansionToTab(
        opts.backend,
        tabId,
        tab,
        match.triggerText.length,
        text,
        cursorOffset
      )
      registerUndo(tabId, text, cursorOffset)
      return
    }

    // Eager-erase the typed trigger so the user doesn't stare at it while
    // shell vars resolve. Mirrors src/app-runtime/use-renderer-bindings.ts:131.
    opts.backend.write(tabId, '\x7f'.repeat(match.triggerText.length))
    inFlight.add(tabId)
    logDebug('gui.host.snippetTrigger.expandAsyncStart', {
      snippetName: snippet.name,
      tabId,
      triggerLength: match.triggerText.length,
    })

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
        writeMacroExpansionToTab(opts.backend, tabId, tab, 0, text, cursorOffset)
        registerUndo(tabId, text, cursorOffset)
        logDebug('gui.host.snippetTrigger.expandAsyncDone', {
          snippetName: snippet.name,
          tabId,
        })
      } catch (error) {
        logDebug('gui.host.snippetTrigger.expandAsyncError', {
          error: error instanceof Error ? error.message : String(error),
          snippetName: snippet.name,
          tabId,
        })
      } finally {
        inFlight.delete(tabId)
      }
    })()
  }

  return {
    dispose(tabId) {
      detectors.delete(tabId)
      inFlight.delete(tabId)
      pendingUndo.delete(tabId)
    },
    feedKey(tabId, char) {
      // While an async expansion is in flight on this tab, swallow any new
      // chars into the detector reset so the buffer doesn't keep growing
      // and racing with the awaited write.
      if (inFlight.has(tabId)) {
        detectors.get(tabId)?.reset()
        return false
      }
      const match = getOrCreateDetector(tabId).feed(char)
      if (!match) return false
      expandMacro(tabId, match)
      return true
    },
    reset(tabId) {
      detectors.get(tabId)?.reset()
    },
    tryConsumeUndo(tabId, sequence) {
      const entry = pendingUndo.get(tabId)
      if (!entry) return false
      pendingUndo.delete(tabId)
      const isBackspace = sequence === '\x7f' || sequence === '\b'
      if (!isBackspace) return false
      const rightArrows = '\x1b[C'.repeat(entry.suffixLength)
      const dels = '\x7f'.repeat(entry.fullLength)
      opts.backend.write(tabId, `${rightArrows}${dels}`)
      return true
    },
  }
}
