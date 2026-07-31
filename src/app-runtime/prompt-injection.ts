// Sends the create-workspace prompt into the assistant that was just launched.
//
// The hard part is knowing when the assistant will accept it. Measured against
// a real `claude` pty: it enables bracketed paste ~350ms after spawn but drops
// anything pasted before ~1s, and that gap is not a constant — the same binary
// in a different directory still swallowed a paste 1.5s after the flag.
//
// So no delay is trusted. Bracketed paste is only the coarse "the pty is in raw
// mode" gate; after it we paste and then *check the screen* for the text,
// retrying until it shows up. Enter is sent once, at the end, so a prompt is
// never half-submitted.

import type { SessionBackend } from '../session-backend/types'
import type { AppState, TerminalSnapshot } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { getLineText } from '../input/terminal-text-extraction'
import { writePasteToTab, writeToTab } from './pty-write'

const POLL_INTERVAL_MS = 100
/** Past this the command is either unusually slow or is not a TUI at all. */
const READY_TIMEOUT_MS = 20_000

/** Time for the assistant to redraw with the pasted text before we look. */
const ECHO_WAIT_MS = 500
const MAX_ATTEMPTS = 12

/** Ctrl+U. Clears whatever a previous attempt left behind so retries cannot stack. */
const CLEAR_INPUT = '\x15'
const SUBMIT = '\r'

/**
 * Enough of the prompt to recognise on screen, short enough to survive the
 * input box wrapping it onto the next row.
 */
const PROBE_LENGTH = 16
const MIN_PROBE_LENGTH = 4

export interface InjectPromptOptions {
  backend: SessionBackend
  getState: () => AppState
  tabId: string
  prompt: string
  pollIntervalMs?: number
  timeoutMs?: number
  echoWaitMs?: number
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function screenText(viewport: TerminalSnapshot | undefined): string {
  if (!viewport) return ''
  return viewport.lines.map((line) => getLineText(line)).join('\n')
}

/** The needle we look for on screen, or null when the prompt cannot be matched on. */
function echoProbe(prompt: string): string | null {
  // A multi-line paste is folded into a "[Pasted text #1 +N lines]" placeholder
  // by every assistant we ship, so there would be nothing on screen to find and
  // every attempt would "fail" until the cap.
  if (prompt.includes('\n')) return null
  const probe = prompt.trim().slice(0, PROBE_LENGTH)
  return probe.length >= MIN_PROBE_LENGTH ? probe : null
}

/**
 * Paste the prompt into the tab's assistant and submit it.
 *
 * ponytail: a 100ms poll over state, because the pty layer exposes no "modes
 * changed" event to await. Retries are bounded and always preceded by Ctrl+U,
 * so the worst case is one unverified paste — never two stacked ones.
 */
export async function injectPromptWhenReady(options: InjectPromptOptions): Promise<void> {
  const { backend, getState, prompt, tabId } = options
  if (prompt.trim() === '') return

  const sleep = options.sleep ?? defaultSleep
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const deadline = options.timeoutMs ?? READY_TIMEOUT_MS
  const echoWait = options.echoWaitMs ?? ECHO_WAIT_MS
  const attempts = options.maxAttempts ?? MAX_ATTEMPTS
  const probe = echoProbe(prompt)

  const currentTab = () => getState().tabs.find((entry) => entry.id === tabId)

  logInputDebug('app.promptInjection.start', { promptLength: prompt.length, tabId })

  for (let waited = 0; waited < deadline; waited += interval) {
    const tab = currentTab()
    // The tab was closed, or the command died on startup: nothing to type into.
    if (!tab || tab.status === 'error' || tab.status === 'disconnected') {
      logInputDebug('app.promptInjection.abandoned', { status: tab?.status ?? 'gone', tabId })
      return
    }
    if (tab.terminalModes.bracketedPasteMode) break
    await sleep(interval)
  }

  let landed = false
  for (let attempt = 0; attempt < attempts && !landed; attempt++) {
    const tab = currentTab()
    if (!tab) {
      logInputDebug('app.promptInjection.abandoned', { status: 'gone', tabId })
      return
    }
    if (attempt > 0) writeToTab(backend, tabId, tab, CLEAR_INPUT)
    writePasteToTab(backend, tabId, tab, prompt)
    await sleep(echoWait)
    // No usable probe (a one-word prompt, or text the assistant folds into a
    // "pasted N lines" placeholder): take the first paste on faith.
    landed = probe == null || screenText(currentTab()?.viewport).includes(probe)
    logInputDebug('app.promptInjection.attempt', { attempt: attempt + 1, landed, tabId })
  }

  const tab = currentTab()
  if (!tab) return
  writeToTab(backend, tabId, tab, SUBMIT)
  logInputDebug('app.promptInjection.submitted', { landed, tabId })
}
