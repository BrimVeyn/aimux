import { Terminal as XTerm } from '@xterm/headless'
import { type IPty, spawn } from 'bun-pty'
import { EventEmitter } from 'node:events'

import type {
  ScrollIntent,
  TerminalCursorStyle,
  TerminalModeState,
  TerminalSnapshot,
} from '../state/types'

import { logDebug } from '../debug/input-log'
import { applyGhosttyShellIntegration } from './ghostty-shell-integration'
import { areTerminalSnapshotsEqual, snapshotTerminal } from './terminal-snapshot'

interface PtyManagerEvents {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState]
  exit: [tabId: string, exitCode: number]
  error: [tabId: string, message: string]
}

interface SessionHandle {
  tabId: string
  pty: IPty
  emulator: XTerm
  lastSnapshot?: TerminalSnapshot
  lastTerminalModes?: TerminalModeState
  alternateScrollMode: boolean
  cursorVisible: boolean
  /** Last DECSCUSR shape; 'default' = the host terminal's configured cursor. */
  cursorStyle: TerminalCursorStyle
  /** Last DECSCUSR blink flag; undefined until an explicit DECSCUSR arrives. */
  cursorBlink: boolean | undefined
  pendingModeSequence: string
  pendingWrites: number
  pendingExitCode: number | null
  /** Scroll intent from the most recent resize, re-applied after the
   *  parser drains the data that was queued across the resize. */
  lastScrollIntent: ScrollIntent | undefined
  /** Set when a resize landed while writes were in flight; the viewport is
   *  re-anchored once pendingWrites reaches 0. */
  reanchorAfterDrain: boolean
}

const ESC = '\x1b'
const PRIVATE_MODE_RE = new RegExp(`${ESC}\\[\\?([0-9;]+)([hl])`, 'g')

function getPendingModeSequence(sequence: string): string {
  const escapeIndex = sequence.lastIndexOf('\x1b')
  if (escapeIndex === -1) {
    return ''
  }

  const suffix = sequence.slice(escapeIndex)
  return new RegExp(`^${ESC}(?:\\[\\??[0-9;]*)?$`).test(suffix) ? suffix : ''
}

function trackPrivateModes(
  alternateScrollMode: boolean,
  cursorVisible: boolean,
  pendingSequence: string,
  data: string
): {
  alternateScrollMode: boolean
  cursorVisible: boolean
  pendingSequence: string
} {
  const sequence = `${pendingSequence}${data}`
  let nextAlternateScrollMode = alternateScrollMode
  let nextCursorVisible = cursorVisible
  for (const match of sequence.matchAll(PRIVATE_MODE_RE)) {
    const parameters = match[1]?.split(';') ?? []
    if (parameters.includes('1007')) {
      nextAlternateScrollMode = match[2] === 'h'
    }
    if (parameters.includes('25')) {
      nextCursorVisible = match[2] === 'h'
    }
  }

  return {
    alternateScrollMode: nextAlternateScrollMode,
    cursorVisible: nextCursorVisible,
    pendingSequence: getPendingModeSequence(sequence),
  }
}

// DECSCUSR (CSI Ps SP q): 0 resets to the terminal's configured cursor,
// odd values blink, 1/2 = block, 3/4 = underline, 5/6 = bar.
const DECSCUSR_STYLES: readonly TerminalCursorStyle[] = [
  'block',
  'block',
  'underline',
  'underline',
  'bar',
  'bar',
]

function decscusrToCursorState(ps: number): {
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean | undefined
} {
  const style = DECSCUSR_STYLES[ps - 1]
  if (ps === 0 || style === undefined) {
    return { cursorBlink: undefined, cursorStyle: 'default' }
  }
  return { cursorBlink: ps % 2 === 1, cursorStyle: style }
}

function getTerminalModes(emulator: XTerm, alternateScrollMode: boolean): TerminalModeState {
  return {
    alternateScrollMode,
    bracketedPasteMode: emulator.modes.bracketedPasteMode,
    isAlternateBuffer: emulator.buffer.active === emulator.buffer.alternate,
    mouseTrackingMode: emulator.modes.mouseTrackingMode,
    sendFocusMode: emulator.modes.sendFocusMode,
  }
}

// Read the scroll position straight from the emulator that owns it. This is the
// single source of truth for re-anchoring across a resize: deriving it here
// (zero latency) instead of accepting a frontend-supplied intent avoids the
// stale-mirror drift that desynced selection/copy from the rendered viewport.
function deriveEmulatorScrollIntent(emulator: XTerm): ScrollIntent {
  const buffer = emulator.buffer.active
  return buffer.viewportY >= buffer.baseY
    ? { kind: 'bottom' }
    : { absoluteLine: buffer.viewportY, kind: 'anchor' }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const RENDER_COALESCE_MS = 16
const DATA_DEBOUNCE_MS = envInt('AIMUX_RENDER_DEBOUNCE_MS', 8)

export class PtyManager extends EventEmitter<PtyManagerEvents> {
  private sessions = new Map<string, SessionHandle>()
  private pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * When false, snapshot+emit work is suppressed because no UI client is
   * watching. xterm.write still runs (the buffer must stay correct) — only
   * the projection cost is gated. Re-enable triggers a full flush per session.
   */
  private broadcastEnabled = true

  setBroadcastEnabled(enabled: boolean): void {
    if (enabled === this.broadcastEnabled) return
    this.broadcastEnabled = enabled
    logDebug('ptyManager.setBroadcastEnabled', { enabled, sessions: this.sessions.size })
    if (enabled) {
      // Force-flush every session: lastSnapshot is stale (or unset) so the
      // change check inside emitRenderIfChanged will fire and the daemon
      // gets the current viewport for each tab on resume.
      for (const session of this.sessions.values()) {
        this.flushRenderNow(session)
      }
    } else {
      // Drop pending timers — they would do snapshot work nobody is watching.
      // Iterate values() first then clear; Map deletion during iteration is
      // defined behaviour but capturing the timers up-front keeps it obvious.
      for (const timer of this.pendingFlushes.values()) {
        clearTimeout(timer)
      }
      this.pendingFlushes.clear()
    }
  }

  /** True iff there's at least one live PTY session. Used by lifecycle gates. */
  hasSessions(): boolean {
    return this.sessions.size > 0
  }

  private clearTimers(tabId: string): void {
    const flush = this.pendingFlushes.get(tabId)
    if (flush) {
      clearTimeout(flush)
      this.pendingFlushes.delete(tabId)
    }
  }

  private scheduleRender(session: SessionHandle): void {
    if (!this.broadcastEnabled) return
    if (this.pendingFlushes.has(session.tabId)) {
      return
    }
    const timer = setTimeout(() => {
      this.pendingFlushes.delete(session.tabId)
      if (this.sessions.get(session.tabId) !== session) {
        return
      }
      this.emitRenderIfChanged(session)
    }, RENDER_COALESCE_MS)
    this.pendingFlushes.set(session.tabId, timer)
  }

  private scheduleDataRender(session: SessionHandle): void {
    if (!this.broadcastEnabled) return
    if (this.pendingFlushes.has(session.tabId)) {
      return
    }
    const flushTimer = setTimeout(() => {
      this.pendingFlushes.delete(session.tabId)
      if (this.sessions.get(session.tabId) !== session) {
        return
      }
      if (session.pendingWrites > 0) {
        this.scheduleDataRender(session)
        return
      }
      this.emitRenderIfChanged(session)
    }, DATA_DEBOUNCE_MS)
    this.pendingFlushes.set(session.tabId, flushTimer)
  }

  private flushRenderNow(session: SessionHandle): void {
    this.clearTimers(session.tabId)
    this.emitRenderIfChanged(session)
  }

  private emitRenderIfChanged(session: SessionHandle): void {
    if (!this.broadcastEnabled) return
    const nextSnapshot = snapshotTerminal(session.emulator, {
      cursorBlink: session.cursorBlink,
      cursorStyle: session.cursorStyle,
      cursorVisible: session.cursorVisible,
    })
    const nextTerminalModes = getTerminalModes(session.emulator, session.alternateScrollMode)
    const snapshotChanged = !areTerminalSnapshotsEqual(session.lastSnapshot, nextSnapshot)
    const modesChanged =
      !session.lastTerminalModes ||
      session.lastTerminalModes.mouseTrackingMode !== nextTerminalModes.mouseTrackingMode ||
      session.lastTerminalModes.sendFocusMode !== nextTerminalModes.sendFocusMode ||
      session.lastTerminalModes.alternateScrollMode !== nextTerminalModes.alternateScrollMode ||
      session.lastTerminalModes.isAlternateBuffer !== nextTerminalModes.isAlternateBuffer ||
      session.lastTerminalModes.bracketedPasteMode !== nextTerminalModes.bracketedPasteMode

    if (!snapshotChanged && !modesChanged) {
      return
    }

    session.lastSnapshot = nextSnapshot
    session.lastTerminalModes = nextTerminalModes
    logDebug('ptyManager.render', {
      isAlternateBuffer: nextTerminalModes.isAlternateBuffer,
      lines: nextSnapshot.lines.length,
      tabId: session.tabId,
      viewportY: nextSnapshot.viewportY,
    })
    this.emit('render', session.tabId, nextSnapshot, nextTerminalModes)
  }

  private finalizeSession(session: SessionHandle, exitCode: number): void {
    const current = this.sessions.get(session.tabId)
    if (current !== session) {
      return
    }

    this.sessions.delete(session.tabId)
    this.flushRenderNow(session)
    session.emulator.dispose()
    logDebug('ptyManager.finalize', { exitCode, tabId: session.tabId })
    this.emit('exit', session.tabId, exitCode)
  }

  createSession(options: {
    tabId: string
    command: string
    args?: string[]
    cols: number
    rows: number
    cwd?: string
    /** Extra environment variables merged on top of `process.env` for this PTY. */
    env?: Record<string, string>
  }): void {
    this.disposeSession(options.tabId)
    logDebug('ptyManager.create.start', {
      args: options.args ?? [],
      cols: options.cols,
      command: options.command,
      cwd: options.cwd ?? process.cwd(),
      rows: options.rows,
      tabId: options.tabId,
    })

    try {
      const emulator = new XTerm({
        allowProposedApi: true,
        cols: options.cols,
        rows: options.rows,
        scrollback: 1000,
      })

      const env = applyGhosttyShellIntegration(
        {
          ...process.env,
          COLORTERM: 'truecolor',
          TERM: 'xterm-256color',
          ...options.env,
        },
        options.command
      )

      const pty = spawn(options.command, options.args ?? [], {
        cols: options.cols,
        cwd: options.cwd ?? process.cwd(),
        env,
        name: 'xterm-256color',
        rows: options.rows,
      })

      const session: SessionHandle = {
        alternateScrollMode: false,
        cursorBlink: undefined,
        cursorStyle: 'default',
        cursorVisible: true,
        emulator,
        lastScrollIntent: undefined,
        lastSnapshot: undefined,
        lastTerminalModes: undefined,
        pendingExitCode: null,
        pendingModeSequence: '',
        pendingWrites: 0,
        pty,
        reanchorAfterDrain: false,
        tabId: options.tabId,
      }

      // xterm parses DECSCUSR itself but keeps the result in private state;
      // mirror it here so snapshots can carry the shape to the renderer.
      // Returning false lets xterm's own handler still run.
      emulator.parser.registerCsiHandler({ final: 'q', intermediates: ' ' }, (params) => {
        const raw = params[0]
        const tracked = decscusrToCursorState(typeof raw === 'number' ? raw : 0)
        session.cursorStyle = tracked.cursorStyle
        session.cursorBlink = tracked.cursorBlink
        return false
      })

      // Wire the emulator's reply channel back to the pty. When a program
      // writes a query sequence — CPR (ESC[6n), Device Attributes (ESC[c),
      // Device Status (ESC[5n), DECRQM, OSC color queries — xterm generates
      // the answer and emits it via onData. Without forwarding it the program
      // waits forever for a response it never gets (e.g. AWS CLI / Python
      // prompt_toolkit warns "terminal doesn't support cursor position
      // requests (CPR)"). These replies are produced synchronously inside the
      // emulator.write() below, so write straight to the pty rather than
      // queueing through the render path. The listener is disposed together
      // with the emulator in finalize/dispose, mirroring registerCsiHandler.
      //
      // onBinary (legacy non-UTF-8 mouse reports) is intentionally not wired:
      // bun-pty.write() only accepts a UTF-8 string so byte values >127 can't
      // be transmitted faithfully, and the headless emulator is never fed raw
      // mouse input, so it never generates those reports in the first place.
      emulator.onData((reply) => {
        session.pty.write(reply)
      })

      pty.onData((data) => {
        logDebug('ptyManager.data', {
          byteLength: Buffer.byteLength(data, 'utf8'),
          pendingWrites: session.pendingWrites,
          tabId: options.tabId,
        })
        const trackedModes = trackPrivateModes(
          session.alternateScrollMode,
          session.cursorVisible,
          session.pendingModeSequence,
          data
        )
        session.alternateScrollMode = trackedModes.alternateScrollMode
        session.cursorVisible = trackedModes.cursorVisible
        session.pendingModeSequence = trackedModes.pendingSequence
        session.pendingWrites += 1
        this.scheduleDataRender(session)
        emulator.write(data, () => {
          session.pendingWrites -= 1

          if (session.pendingWrites === 0 && session.reanchorAfterDrain) {
            // The data queued across a resize has now been parsed into the
            // reflowed buffer. Re-anchor the viewport before it is snapshotted
            // so the active screen — not stale scrollback — is what renders.
            session.reanchorAfterDrain = false
            this.applyScrollIntent(session, session.lastScrollIntent)
          }

          this.scheduleDataRender(session)

          if (session.pendingWrites === 0 && session.pendingExitCode !== null) {
            this.finalizeSession(session, session.pendingExitCode)
          }
        })
      })

      pty.onExit(({ exitCode }) => {
        logDebug('ptyManager.exit', { exitCode, tabId: options.tabId })
        const current = this.sessions.get(options.tabId)
        if (!current || current.pty !== pty) {
          return
        }

        if (session.pendingWrites > 0) {
          session.pendingExitCode = exitCode
          return
        }

        this.finalizeSession(session, exitCode)
      })

      this.sessions.set(options.tabId, session)
      logDebug('ptyManager.create.success', { tabId: options.tabId })
      this.scheduleRender(session)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logDebug('ptyManager.create.error', { error: message, tabId: options.tabId })
      this.emit('error', options.tabId, `Failed to start session: ${message}`)
    }
  }

  write(tabId: string, input: string): void {
    const session = this.sessions.get(tabId)
    if (!session) return
    session.pty.write(input)
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    const session = this.sessions.get(tabId)
    if (!session) {
      return
    }

    session.emulator.scrollLines(deltaLines)
    this.scheduleRender(session)
  }

  scrollViewportToBottom(tabId: string): void {
    const session = this.sessions.get(tabId)
    if (!session) {
      return
    }

    session.emulator.scrollToBottom()
    this.scheduleRender(session)
  }

  private applyScrollIntent(session: SessionHandle, intent: ScrollIntent | undefined): void {
    if (!intent || intent.kind === 'bottom') {
      session.emulator.scrollToBottom()
      return
    }

    const baseY = session.emulator.buffer.active.baseY
    if (intent.absoluteLine >= baseY) {
      session.emulator.scrollToBottom()
      return
    }

    session.emulator.scrollToLine(Math.max(0, intent.absoluteLine))
  }

  private applyResize(session: SessionHandle, cols: number, rows: number, sync: boolean): void {
    // Capture the scroll position from the emulator *before* reflow, so the
    // re-anchor restores where the user actually was. The frontend no longer
    // supplies an intent — the backend owns scroll position end to end.
    const intent = deriveEmulatorScrollIntent(session.emulator)
    const safeCols = Math.max(20, cols)
    const safeRows = Math.max(8, rows)
    session.pty.resize(safeCols, safeRows)
    session.emulator.resize(safeCols, safeRows)
    session.lastScrollIntent = intent
    this.applyScrollIntent(session, intent)

    if (session.pendingWrites > 0) {
      // Output produced by the child for the pre-resize size is still queued
      // in the xterm parser. Snapshotting now would capture a torn buffer
      // (reflowed but not yet redrawn); a plain shell never issues a full
      // repaint, so the shifted content + dead rows would stick. Defer the
      // snapshot to the drain path, which re-anchors the viewport first.
      session.reanchorAfterDrain = true
      this.scheduleDataRender(session)
      return
    }

    if (sync) {
      this.flushRenderNow(session)
    } else {
      this.scheduleRender(session)
    }
  }

  resizeAll(cols: number, rows: number, options?: { sync?: boolean }): void {
    for (const session of this.sessions.values()) {
      this.applyResize(session, cols, rows, options?.sync ?? false)
    }
  }

  resizeSession(tabId: string, cols: number, rows: number, options?: { sync?: boolean }): void {
    const session = this.sessions.get(tabId)
    if (!session) {
      return
    }
    this.applyResize(session, cols, rows, options?.sync ?? false)
  }

  disposeSession(tabId: string): void {
    const session = this.sessions.get(tabId)
    if (!session) {
      return
    }

    this.clearTimers(tabId)
    this.sessions.delete(tabId)
    session.pty.kill()
    session.emulator.dispose()
  }

  disposeAll(): void {
    for (const tabId of this.sessions.keys()) {
      this.clearTimers(tabId)
    }
    for (const session of this.sessions.values()) {
      session.pty.kill()
      session.emulator.dispose()
    }

    this.sessions.clear()
  }
}
