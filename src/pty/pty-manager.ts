import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal as XTerm } from '@xterm/headless'
import { type IPty, spawn } from 'bun-pty'
import { EventEmitter } from 'node:events'

import type { ScrollIntent, TerminalModeState, TerminalSnapshot } from '../state/types'

import { logDebug } from '../debug/input-log'
import { areTerminalSnapshotsEqual, snapshotTerminal } from './terminal-snapshot'

interface PtyManagerEvents {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState]
  bytes: [tabId: string, data: string]
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
  pendingModeSequence: string
  pendingWrites: number
  pendingExitCode: number | null
  /** Scroll intent from the most recent resize, re-applied after the
   *  parser drains the data that was queued across the resize. */
  lastScrollIntent: ScrollIntent | undefined
  /** Set when a resize landed while writes were in flight; the viewport is
   *  re-anchored once pendingWrites reaches 0. */
  reanchorAfterDrain: boolean
  /** Latched once onExit fires (either via the read-loop's CHILD_EXITED path
   *  or via the synthetic exit pty.kill() fires). Used to (a) dedupe the
   *  second onExit when finalizeSession closes the FFI handle via pty.kill(),
   *  and (b) skip the deferred SIGKILL escalation once the child has been
   *  reaped (the only safe signal that the pid we are targeting is still
   *  ours and not an OS-recycled pid). */
  reaped: boolean
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
    const nextSnapshot = snapshotTerminal(session.emulator, session.cursorVisible)
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
    // Release the FFI handle now that the child is reaped and the emulator is
    // dropped. pty.kill() fires a synthetic onExit; session.reaped is already
    // true so the listener returns early.
    try {
      session.pty.kill()
    } catch {
      // handle already closed — fine
    }
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

      const pty = spawn(options.command, options.args ?? [], {
        cols: options.cols,
        cwd: options.cwd ?? process.cwd(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
        name: 'xterm-256color',
        rows: options.rows,
      })

      const session: SessionHandle = {
        alternateScrollMode: false,
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
        reaped: false,
        tabId: options.tabId,
      }

      pty.onData((data) => {
        // If the session has been replaced (createSession fired again for
        // this tabId while the old child was still being torn down), the old
        // child's residual output must NOT be emitted on the new session's
        // tabId — it would corrupt the new stream. The old emulator is
        // disposed in the onExit "replaced" branch.
        if (this.sessions.get(options.tabId) !== session) {
          return
        }
        logDebug('ptyManager.data', {
          byteLength: Buffer.byteLength(data, 'utf8'),
          pendingWrites: session.pendingWrites,
          tabId: options.tabId,
        })
        // Forward raw PTY bytes to subscribers (GUI streams these to a
        // client-side xterm.js for pixel-perfect rendering). Runs in parallel
        // with the snapshot pipeline below — TUI keeps using snapshots.
        this.emit('bytes', options.tabId, data)
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
        // Dedupe: pty.kill() fires a synthetic onExit. finalizeSession calls
        // pty.kill() to release the FFI handle after a real exit, so we will
        // see this callback twice for the same session. First-write wins.
        if (session.reaped) {
          return
        }
        session.reaped = true

        logDebug('ptyManager.exit', { exitCode, tabId: options.tabId })
        const current = this.sessions.get(options.tabId)
        if (!current || current.pty !== pty) {
          // Session was replaced (createSession called again for this tabId)
          // while the old child was still being torn down. We still own the
          // orphan's emulator + FFI handle; drop them so they don't leak.
          session.emulator.dispose()
          try {
            session.pty.kill()
          } catch {
            // handle already closed — fine
          }
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

  /**
   * Snapshot the session's terminal buffer as an ANSI byte string. The GUI
   * client writes this dump into its xterm.js on (re)connect / tab focus so
   * the visible scrollback is restored before live `bytes` events resume.
   * Returns '' for unknown tabIds.
   */
  serializeBuffer(tabId: string): string {
    const session = this.sessions.get(tabId)
    if (!session) return ''
    const addon = new SerializeAddon()
    try {
      session.emulator.loadAddon(addon)
      return addon.serialize()
    } finally {
      addon.dispose()
    }
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
    // Do NOT delete from this.sessions, do NOT dispose the emulator, do NOT
    // call pty.kill() yet. The read-loop must stay alive to observe
    // CHILD_EXITED and waitpid the child — otherwise the child becomes a
    // <defunct> zombie after the eventual SIGKILL because nobody reaps it.
    // SIGTERM directly to the pid; escalate to SIGKILL at +2s if still alive.
    // The natural onExit path runs finalizeSession, which releases the FFI
    // handle and disposes the emulator.
    this.reapPtyProcess(session, { escalate: true })
  }

  disposeAll(): void {
    for (const tabId of this.sessions.keys()) {
      this.clearTimers(tabId)
    }
    for (const session of this.sessions.values()) {
      // Host shutdown: send SIGTERM then SIGKILL synchronously. The host is
      // about to process.exit(0); even if the read-loop is killed before it
      // can waitpid, the children are reparented to init which reaps them, so
      // no long-lived defunct. We do NOT call pty.kill() (which would close
      // the master fd and trigger SIGHUP that claude ignores).
      this.reapPtyProcess(session, { escalate: false })
    }
  }

  /**
   * Send SIGTERM (and, on escalation, SIGKILL) to the PTY's child process pid.
   *
   * Critical: this MUST be called while the bun-pty read-loop is still alive.
   * The read-loop is the only place bun-pty calls waitpid (via its
   * CHILD_EXITED branch); if we close the master fd first (pty.kill() sets
   * _closing = true and stops the loop), the dying child has nobody to reap
   * it and lingers as `Z <defunct>` under the host until host shutdown.
   *
   * The deferred SIGKILL is guarded by session.reaped — set by onExit. This is
   * the only reliable signal that the pid we are about to escalate to is
   * still OUR child and not an OS-recycled pid (which is possible on macOS
   * within the 2-second window). The group-kill `process.kill(-pid, ...)`
   * that used to live here was removed for the same reason: aimux spawns the
   * command as its own process leader so pty.pid IS the only target, and
   * group-killing a recycled pid would target an unrelated session group.
   *
   * Per-tab close escalates SIGTERM -> SIGKILL after a grace period so the
   * process can exit cleanly; shutdown kills outright since nothing will be
   * around to run the deferred escalation.
   */
  private reapPtyProcess(session: SessionHandle, options: { escalate: boolean }): void {
    const pid = session.pty.pid
    if (!Number.isInteger(pid) || pid <= 1) {
      return
    }

    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone (raced with a natural exit) — read-loop will fire onExit
    }

    if (!options.escalate) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
      return
    }

    setTimeout(() => {
      if (session.reaped) {
        // SIGTERM was respected; read-loop already waitpid'd. No zombie.
        return
      }
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // gone between the check and the kill — fine
      }
    }, 2_000).unref?.()
  }
}
