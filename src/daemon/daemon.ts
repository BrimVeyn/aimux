import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'

import type { AssistantId, TabSession, TabStatus, TerminalSnapshot } from '../state/types'

import { logDebug } from '../debug/input-log'
import { type ClaudeHookServer, startClaudeHookServer } from '../integrations/claude-hook-server'
import {
  type ClientRequest,
  encodeMessage,
  getProcessVersion,
  IPC_PROTOCOL_CAPABILITIES,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  negotiateProtocolVersion,
  parseClientRequest,
  type ServerEvent,
  type ServerResponse,
  type TabSessionSummary,
} from '../ipc/protocol'
import { findSocketProcessPid, spawnDetachedTerminalManager } from '../platform/daemon-control'
import { type LoopTabView, runStatusDetectionLoop } from '../pty/assistant-status-detection-loop'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import { TerminalManagerClient } from '../terminal-manager/manager-client'
import {
  consumeDaemonHandoff,
  getClaudeHookUrlFilePath,
  getDaemonOldSocketPath,
  getIpcDaemonSocketPath,
  getSocketSecurityIssue,
  getTerminalManagerSocketPath,
  removeDaemonSidecars,
  removeDaemonSidecarsForReexec,
  removeDaemonSocketIfExists,
  removeTerminalManagerSocketIfExists,
  tightenSocketPermissions,
  writeDaemonHandoff,
  writeDaemonPidFile,
  writeDaemonVersionFile,
} from './runtime-paths'

export interface DaemonTabEntry {
  sessionId: string
  assistant: AssistantId
  command: string
  viewport: TerminalSnapshot | undefined
  /**
   * Monotonic viewport sequence. Incremented on every render-event write so
   * stale writers (e.g. `attach` returning a pre-await snapshot) can refuse
   * to clobber a fresher viewport that arrived via `render` while the
   * `attachSession` call was still in flight.
   */
  viewportSeq: number
  /**
   * Slim TabSession metadata cached so the `listTabs` request type can answer
   * without round-tripping the TM. Populated on attach (full data from
   * `attachResult.tabs`) and on createTab (title taken from the request,
   * status defaulted to 'starting' until a render or status update lands).
   */
  title?: string
  status?: TabStatus
  worktreeId?: string
}

/**
 * Merges an attach-time tab view into the registry without clobbering a
 * viewport that arrived via a render event during the `attachSession` await.
 *
 * Returns the updated entry (also written into `registry`). `seq` is a
 * monotonic counter scoped to the registry; pass the same counter into every
 * call so the new entry slot gets a stable ordinal when we first observe it.
 *
 * Exported for unit tests — the attach path in `runDaemon` uses the same
 * helper through a closure that threads the counter.
 */
export function mergeTabRegistryEntry(
  registry: Map<string, DaemonTabEntry>,
  sessionId: string,
  tabId: string,
  assistant: AssistantId,
  command: string,
  initialViewport: TerminalSnapshot | undefined,
  allocateSeq: () => number,
  metadata?: { title?: string; status?: TabStatus; worktreeId?: string }
): DaemonTabEntry {
  const existing = registry.get(tabId)
  const viewport = existing?.viewport ?? initialViewport
  const entry: DaemonTabEntry = {
    assistant,
    command,
    sessionId,
    status: metadata?.status ?? existing?.status,
    title: metadata?.title ?? existing?.title,
    viewport,
    viewportSeq: existing?.viewportSeq ?? (viewport ? allocateSeq() : 0),
    worktreeId: metadata?.worktreeId ?? existing?.worktreeId,
  }
  registry.set(tabId, entry)
  return entry
}

function send(socket: Socket, message: ServerResponse | ServerEvent): void {
  socket.write(encodeMessage(message))
}

function sendOk(socket: Socket, id: string): void {
  send(socket, { id, payload: {}, type: 'ok' })
}

function requireSession(socket: Socket, attachedSessions: Map<Socket, string>): string {
  const sessionId = attachedSessions.get(socket)
  if (!(sessionId != null && sessionId !== '')) {
    throw new Error('No session attached')
  }
  return sessionId
}

function requireNegotiatedVersion(socket: Socket, versions: Map<Socket, number>): number {
  const version = versions.get(socket)
  if (version === undefined) {
    throw new Error('Protocol handshake required before attach')
  }
  return version
}

async function canConnectToSocket(socketPath: string): Promise<boolean> {
  const securityIssue = getSocketSecurityIssue(socketPath)
  if (securityIssue != null && securityIssue !== '') {
    logDebug('daemon.socketUnhealthy', { issue: securityIssue, socketPath })
    return false
  }

  return new Promise<boolean>((resolve) => {
    const socket = connect(socketPath)
    const finish = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function ensureTerminalManagerReady(manager: TerminalManagerClient): Promise<void> {
  try {
    logDebug('daemon.ensureTerminalManager.connectExisting.start', {
      socketPath: getTerminalManagerSocketPath(),
    })
    await manager.connect()
    logDebug('daemon.ensureTerminalManager.connectExisting.success')
    return
  } catch (error) {
    logDebug('daemon.ensureTerminalManager.connectExisting.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    const socketPath = getTerminalManagerSocketPath()
    if (!(await canConnectToSocket(socketPath))) {
      removeTerminalManagerSocketIfExists()
      logDebug('daemon.ensureTerminalManager.spawn.start', { socketPath })
      const ok = await spawnDetachedTerminalManager()
      if (!ok) {
        throw new Error('Failed to start terminal manager')
      }
      logDebug('daemon.ensureTerminalManager.spawn.success', { socketPath })
    }
    await manager.connect()
    logDebug('daemon.ensureTerminalManager.connectAfterSpawn.success')
  }
}

export async function runDaemon(): Promise<void> {
  const socketPath = getIpcDaemonSocketPath()
  // A handoff file means we were spawned to take over from a predecessor
  // daemon that already drained and renamed its socket away. Consume the
  // file so a later fresh boot won't see it. The TM is still running and
  // we'll connect to it normally (no spawn needed).
  const handoff = consumeDaemonHandoff()
  logDebug('daemon.start', {
    handoffFromPid: handoff?.fromPid ?? null,
    handoffFromVersion: handoff?.fromProcessVersion ?? null,
    pid: process.pid,
    socketPath,
  })

  const existingPid = await findSocketProcessPid(socketPath)
  if (existingPid !== null && existingPid !== process.pid) {
    logDebug('daemon.alreadyRunning', { existingPid })
    process.stderr.write(`aimux daemon already running (pid ${existingPid})\n`)
    process.exit(1)
  }

  removeDaemonSocketIfExists()

  const manager = new TerminalManagerClient()
  await ensureTerminalManagerReady(manager)

  const sockets = new Set<Socket>()
  const attachedSessions = new Map<Socket, string>()
  const negotiatedVersions = new Map<Socket, number>()

  // Per-tab registry so the status-detection loop can poll every terminal
  // continuously, not just the one the UI is currently attached to.
  const tabRegistry = new Map<string, DaemonTabEntry>()
  // Active tab id per session, populated from attachResult and updated by
  // setActiveTab. Surfaced by `listTabs` so a headless CLI doesn't need to
  // attach just to know which tab the UI is focused on.
  const sessionActiveTabIds = new Map<string, string | null>()
  // Last (cols, rows) the session was attached with. `createTab` with
  // cols/rows = 0 falls back to this when the `createTabSizeFallback`
  // capability is in play.
  const sessionDimensions = new Map<string, { cols: number; rows: number }>()
  let nextViewportSeq = 1

  const allocateSeq = (): number => nextViewportSeq++
  const rememberTab = (
    sessionId: string,
    tabId: string,
    assistant: AssistantId,
    command: string,
    initialViewport?: TerminalSnapshot,
    metadata?: { title?: string; status?: TabStatus; worktreeId?: string }
  ): void => {
    const before = tabRegistry.get(tabId)
    const entry = mergeTabRegistryEntry(
      tabRegistry,
      sessionId,
      tabId,
      assistant,
      command,
      initialViewport,
      allocateSeq,
      metadata
    )
    logDebug('daemon.rememberTab', {
      hadExistingEntry: before !== undefined,
      hadExistingViewport: before?.viewport !== undefined,
      initialViewportProvided: initialViewport !== undefined,
      preservedExistingViewport:
        before?.viewport !== undefined && entry.viewport === before.viewport,
      resultSeq: entry.viewportSeq,
      sessionId,
      tabId,
    })
  }

  const broadcastAll = (event: ServerEvent): void => {
    for (const socket of sockets) {
      send(socket, event)
    }
  }

  const broadcastForSession = (sessionId: string, event: ServerEvent): void => {
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event)
      }
    }
  }

  // Fan a server event only to sockets that negotiated a version supporting
  // it. Older peers whose `parseServerMessage` doesn't recognise the type
  // would throw on receipt and drop the connection — MIN_VERSION stays at 10
  // for compat, so we can't rely on every attached socket being v11.
  const broadcastForSessionVersioned = (
    sessionId: string,
    minVersion: number,
    event: ServerEvent
  ): void => {
    for (const socket of sockets) {
      if (attachedSessions.get(socket) !== sessionId) continue
      const version = negotiatedVersions.get(socket)
      if (version === undefined || version < minVersion) continue
      send(socket, event)
    }
  }

  manager.on('render', (sessionId, tabId, viewport, terminalModes) => {
    const existing = tabRegistry.get(tabId)
    let newSeq: number | null = null
    if (existing) {
      existing.viewport = viewport
      existing.viewportSeq = nextViewportSeq++
      existing.sessionId = sessionId
      newSeq = existing.viewportSeq
    }
    logDebug('daemon.manager.render', {
      attachedSocketCount: sockets.size,
      hadRegistryEntry: existing !== undefined,
      newSeq,
      sessionId,
      tabId,
      viewportLines: viewport.lines.length,
    })
    const event: ServerEvent = { payload: { tabId, terminalModes, viewport }, type: 'tabRender' }
    broadcastForSession(sessionId, event)
  })
  manager.on('exit', (sessionId, tabId, exitCode) => {
    logDebug('daemon.manager.exit', { exitCode, sessionId, tabId })
    tabRegistry.delete(tabId)
    if (sessionActiveTabIds.get(sessionId) === tabId) {
      sessionActiveTabIds.set(sessionId, null)
    }
    const event: ServerEvent = { payload: { exitCode, tabId }, type: 'tabExit' }
    broadcastForSession(sessionId, event)
  })
  manager.on('error', (sessionId, tabId, message) => {
    logDebug('daemon.manager.error', { message, sessionId, tabId })
    const event: ServerEvent = { payload: { message, tabId }, type: 'tabError' }
    broadcastForSession(sessionId, event)
  })

  const listTabsForSession = (sessionId: string): LoopTabView[] => {
    const result: LoopTabView[] = []
    for (const [tabId, entry] of tabRegistry) {
      if (entry.sessionId !== sessionId) continue
      result.push({
        assistant: entry.assistant,
        command: entry.command,
        id: tabId,
        viewport: entry.viewport,
      })
    }
    return result
  }

  const statusLoop = runStatusDetectionLoop({
    listSessions: () => {
      const seen = new Set<string>()
      for (const entry of tabRegistry.values()) seen.add(entry.sessionId)
      return [...seen]
    },
    listTabs: listTabsForSession,
    onSessionStatus: (sessionId, status) => {
      logDebug('daemon.status.session', { sessionId, status })
      broadcastAll({ payload: { sessionId, status }, type: 'sessionStatus' })
    },
    onTabStatus: (tabId, status, sessionId) => {
      logDebug('daemon.status.tab', { sessionId, status, tabId })
      // Broadcast to every client. Clients silently ignore events for tabIds
      // they don't know about, so there's no UI impact — this costs one
      // extra socket write per tab per change, which is trivial, and
      // removes a race where in-flight tab events could be dropped when a
      // client tears down its socket to switch sessions.
      broadcastAll({ payload: { sessionId, status, tabId }, type: 'tabStatus' })
    },
  })

  // Local HTTP server that receives Claude Code hook callbacks for every PTY
  // spawned by this daemon. We publish its URL to a stable file path that the
  // shipped shell bridge reads on every invocation, so PTYs spawned by a
  // *previous* daemon transparently follow URL changes after a restart.
  // Failure to start is non-fatal — detection falls back to the visual PTY scanner.
  let hookServer: ClaudeHookServer | null = null
  const hookUrlFilePath = getClaudeHookUrlFilePath()
  try {
    hookServer = startClaudeHookServer({
      onEvent: (event) => {
        statusLoop.recordHookEvent({
          hookEventName: event.hookEventName,
          paneId: event.paneId,
          payload: event.payload,
          receivedAt: event.receivedAt,
        })
      },
    })
    try {
      writeFileSync(hookUrlFilePath, hookServer.url, { mode: 0o600 })
      logDebug('daemon.hookServer.started', { path: hookUrlFilePath, url: hookServer.url })
    } catch (error) {
      logDebug('daemon.hookServer.urlFileWriteFailed', {
        error: error instanceof Error ? error.message : String(error),
        path: hookUrlFilePath,
      })
    }
  } catch (error) {
    logDebug('daemon.hookServer.startFailed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  /**
   * Tell the TM whether to bother snapshotting + broadcasting. Toggled on
   * 0↔1 transitions of the client socket count: when no UI is watching, the
   * TM can skip per-chunk viewport diff/projection work entirely. The TM
   * flushes a fresh snapshot per session on re-enable, so reattaching gives
   * the client a current viewport.
   *
   * Fire-and-forget: failure to send isn't fatal (TM will just keep its
   * previous broadcast state, matching pre-fix behaviour).
   */
  const updateTmBroadcastForClientCount = (count: number): void => {
    void (async () => {
      try {
        await manager.setBroadcastEnabled(count > 0)
      } catch (error) {
        logDebug('daemon.setBroadcastEnabled.error', {
          count,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }

  // Initial state: no clients yet, ask the TM to suspend broadcast.
  updateTmBroadcastForClientCount(0)

  const server = createServer((socket) => {
    logDebug('daemon.client.connected')
    const wasEmpty = sockets.size === 0
    sockets.add(socket)
    if (wasEmpty) updateTmBroadcastForClientCount(sockets.size)
    const decoder = new MessageDecoder<ClientRequest>(parseClientRequest)
    // Serialize chunk processing per socket. Each async iteration crosses a
    // microtask boundary, so without chaining, concurrent `data` callbacks
    // interleave their `await manager.write(...)` calls and PTY writes land
    // out of order (visible as scrambled chars during fast typing/Espanso).
    let processing: Promise<void> = Promise.resolve()

    socket.on('data', (chunk) => {
      const previous = processing
      processing = (async () => {
        try {
          await previous
        } catch {
          // A prior chunk's failure shouldn't block later chunks on this socket.
        }
        try {
          for (const message of decoder.push(chunk)) {
            try {
              switch (message.type) {
                case 'hello': {
                  logDebug('daemon.request.hello', {
                    maxVersion: message.payload.maxVersion,
                    minVersion: message.payload.minVersion,
                  })
                  const selectedVersion = negotiateProtocolVersion(
                    message.payload.minVersion,
                    message.payload.maxVersion,
                    IPC_PROTOCOL_MIN_VERSION,
                    IPC_PROTOCOL_VERSION
                  )
                  if (selectedVersion === null) {
                    send(socket, {
                      id: message.id,
                      payload: { message: 'No compatible app protocol version' },
                      type: 'error',
                    })
                    break
                  }
                  negotiatedVersions.set(socket, selectedVersion)
                  logDebug('daemon.request.hello.success', { selectedVersion })
                  const managerSelectedVersion = manager.getSelectedProtocolVersion()
                  send(socket, {
                    id: message.id,
                    payload: {
                      capabilities: [...IPC_PROTOCOL_CAPABILITIES],
                      ...(managerSelectedVersion !== null && { managerSelectedVersion }),
                      maxVersion: IPC_PROTOCOL_VERSION,
                      minVersion: IPC_PROTOCOL_MIN_VERSION,
                      processVersion: getProcessVersion(),
                      selectedVersion,
                    },
                    type: 'helloResult',
                  })
                  break
                }
                case 'attach': {
                  logDebug('daemon.request.attach.start', {
                    cols: message.payload.cols,
                    rows: message.payload.rows,
                    sessionId: message.payload.sessionId,
                    snapshotTabs: message.payload.workspaceSnapshot?.tabs.length ?? 0,
                    thin: message.payload.thin === true,
                  })
                  const negotiatedVersion = requireNegotiatedVersion(socket, negotiatedVersions)
                  if (message.payload.protocolVersion !== negotiatedVersion) {
                    throw new Error(
                      `Protocol mismatch: client v${message.payload.protocolVersion}, daemon v${negotiatedVersion}`
                    )
                  }

                  attachedSessions.set(socket, message.payload.sessionId)
                  // A thin attacher (headless CLI) does not own a viewport, so
                  // it must not resize PTYs on a session a UI is driving. TM's
                  // attachSession always calls `sessionManager.resize` on the
                  // incoming dimensions, so we substitute prior dims (or a
                  // safe default when none exist) before calling it. That
                  // makes the resize a no-op against the current PTY size
                  // instead of clobbering it. We also seed sessionDimensions
                  // on first-ever thin attach so `createTab`'s 0×0 fallback
                  // works for headless bootstrap flows (no UI has ever
                  // attached to this session).
                  let attachCols = message.payload.cols
                  let attachRows = message.payload.rows
                  const isThin = message.payload.thin === true
                  if (isThin) {
                    const prior = sessionDimensions.get(message.payload.sessionId)
                    if (prior) {
                      attachCols = prior.cols
                      attachRows = prior.rows
                    } else {
                      // No UI has established dimensions yet. Seed a safe
                      // default so PTYs don't spawn at 0×0 and so the
                      // createTab fallback has something to work with. Any
                      // real UI attach afterwards overwrites this.
                      attachCols = 80
                      attachRows = 24
                      sessionDimensions.set(message.payload.sessionId, {
                        cols: attachCols,
                        rows: attachRows,
                      })
                      logDebug('daemon.attach.thin.seedDefaultDimensions', {
                        cols: attachCols,
                        rows: attachRows,
                        sessionId: message.payload.sessionId,
                      })
                    }
                  } else {
                    sessionDimensions.set(message.payload.sessionId, {
                      cols: message.payload.cols,
                      rows: message.payload.rows,
                    })
                  }
                  const attachResult = await manager.attachSession({
                    cols: attachCols,
                    rows: attachRows,
                    sessionId: message.payload.sessionId,
                    workspaceSnapshot: message.payload.workspaceSnapshot,
                  })
                  sessionActiveTabIds.set(message.payload.sessionId, attachResult.activeTabId)
                  for (const tab of attachResult.tabs) {
                    rememberTab(
                      message.payload.sessionId,
                      tab.id,
                      tab.assistant,
                      tab.command,
                      tab.viewport,
                      { status: tab.status, title: tab.title, worktreeId: tab.worktreeId }
                    )
                  }
                  // Classify synchronously BEFORE sending attachResult so
                  // each tab's activity and the full session-status snapshot
                  // are available to embed in the reply. This makes the
                  // client apply them atomically with `hydrate-workspace`
                  // and closes the race where separate `tabStatus` events
                  // landed before the tab existed in client state.
                  const tabsForLoop = listTabsForSession(message.payload.sessionId)
                  logDebug('daemon.attach.preClassify', {
                    sessionId: message.payload.sessionId,
                    tabs: tabsForLoop.map((t) => ({
                      assistant: t.assistant,
                      hasViewport: t.viewport !== undefined,
                      id: t.id,
                      seq: tabRegistry.get(t.id)?.viewportSeq ?? null,
                    })),
                  })
                  statusLoop.classifyNow(message.payload.sessionId, tabsForLoop)
                  const tabsWithActivity = attachResult.tabs.map((tab) => ({
                    ...tab,
                    activity: statusLoop.getTabStatus(tab.id) ?? tab.activity,
                  }))
                  const initialSessionStatuses = statusLoop.snapshotSessions()
                  logDebug('daemon.attach.replay', {
                    sessionId: message.payload.sessionId,
                    sessions: initialSessionStatuses,
                    tabs: tabsWithActivity.map((t) => ({ activity: t.activity, id: t.id })),
                  })
                  send(socket, {
                    id: message.id,
                    payload: {
                      activeTabId: attachResult.activeTabId,
                      initialSessionStatuses,
                      protocolVersion: negotiatedVersion,
                      tabs: tabsWithActivity,
                    },
                    type: 'attachResult',
                  })
                  logDebug('daemon.request.attach.success', {
                    activeTabId: attachResult.activeTabId,
                    sessionId: message.payload.sessionId,
                    tabs: attachResult.tabs.length,
                  })
                  break
                }
                case 'createTab': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  // Capability `createTabSizeFallback`: cols/rows = 0 means
                  // "use the session's last attached dimensions". Headless
                  // CLIs don't have a viewport of their own, so this lets
                  // them spawn a PTY that lines up with the UI on the same
                  // session. If we have no remembered size yet, the TM
                  // would receive 0 and spawn a zero-sized PTY — surface a
                  // clear error instead.
                  let cols = message.payload.cols
                  let rows = message.payload.rows
                  if (cols === 0 || rows === 0) {
                    const prior = sessionDimensions.get(sessionId)
                    if (!prior) {
                      throw new Error(
                        'createTab requested size fallback (cols=0 or rows=0) but no UI has attached to this session yet'
                      )
                    }
                    if (cols === 0) cols = prior.cols
                    if (rows === 0) rows = prior.rows
                  }
                  logDebug('daemon.request.createTab.start', {
                    cols,
                    command: message.payload.command,
                    rows,
                    sessionId,
                    sizeFallback: message.payload.cols === 0 || message.payload.rows === 0,
                    tabId: message.payload.tabId,
                    title: message.payload.title,
                  })
                  const fullCommand = [
                    message.payload.command,
                    ...(message.payload.args ?? []),
                  ].join(' ')
                  rememberTab(
                    sessionId,
                    message.payload.tabId,
                    message.payload.assistant,
                    fullCommand,
                    undefined,
                    {
                      status: 'starting',
                      title: message.payload.title,
                      worktreeId: message.payload.worktreeId,
                    }
                  )
                  // Inject the hook bridge env so Claude Code's hooks can
                  // call back into our status loop. Safe to add for every
                  // assistant: non-Claude binaries simply ignore the vars.
                  // We pass the URL *file path*, not the URL itself, so the
                  // bridge can pick up a fresh URL after a daemon restart
                  // even on PTYs that outlive this daemon process.
                  const env: Record<string, string> = { AIMUX_PANE_ID: message.payload.tabId }
                  if (hookServer) env.AIMUX_HOOK_URL_FILE = hookUrlFilePath
                  await manager.createTab({ ...message.payload, cols, env, rows, sessionId })
                  sendOk(socket, message.id)
                  // Fan a `tabAdded` event only to peers that negotiated at
                  // least v11 — older parsers throw on unknown message types
                  // and would drop the connection. MIN_VERSION stays at 10
                  // for backward compat, so we must gate this at send time.
                  const synthesizedTab: TabSession = {
                    activity: 'idle',
                    assistant: message.payload.assistant,
                    buffer: '',
                    command: fullCommand,
                    id: message.payload.tabId,
                    status: 'starting',
                    terminalModes: createDefaultTerminalModes(),
                    title: message.payload.title,
                    worktreeId: message.payload.worktreeId,
                  }
                  broadcastForSessionVersioned(sessionId, 11, {
                    payload: { sessionId, tab: synthesizedTab },
                    type: 'tabAdded',
                  })
                  logDebug('daemon.request.createTab.success', {
                    sessionId,
                    tabId: message.payload.tabId,
                  })
                  break
                }
                case 'write': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.write(sessionId, message.payload.tabId, message.payload.data)
                  sendOk(socket, message.id)
                  break
                }
                case 'resizeClient': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  sessionDimensions.set(sessionId, {
                    cols: message.payload.cols,
                    rows: message.payload.rows,
                  })
                  await manager.resize(sessionId, message.payload.cols, message.payload.rows)
                  sendOk(socket, message.id)
                  break
                }
                case 'resizeTab': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.resizeTab(
                    sessionId,
                    message.payload.tabId,
                    message.payload.cols,
                    message.payload.rows
                  )
                  sendOk(socket, message.id)
                  break
                }
                case 'scroll': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.scroll(sessionId, message.payload.tabId, message.payload.deltaLines)
                  sendOk(socket, message.id)
                  break
                }
                case 'scrollToBottom': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.scrollToBottom(sessionId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'setActiveTab': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  // Update the cache AFTER the TM confirms the change — if
                  // manager.setActiveTab throws (tab doesn't exist, TM
                  // rejects), the cache would otherwise retain the bogus tabId
                  // and a subsequent listTabs would return a stale activeTabId.
                  await manager.setActiveTab(sessionId, message.payload.tabId)
                  sessionActiveTabIds.set(sessionId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'closeTab': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  tabRegistry.delete(message.payload.tabId)
                  if (sessionActiveTabIds.get(sessionId) === message.payload.tabId) {
                    sessionActiveTabIds.set(sessionId, null)
                  }
                  await manager.closeTab(sessionId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'listTabs': {
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  const sessionId = message.payload.sessionId
                  const tabs: TabSessionSummary[] = []
                  for (const [tabId, entry] of tabRegistry) {
                    if (entry.sessionId !== sessionId) continue
                    tabs.push({
                      activity: statusLoop.getTabStatus(tabId) ?? undefined,
                      assistant: entry.assistant,
                      command: entry.command,
                      id: tabId,
                      status: entry.status ?? 'running',
                      title: entry.title ?? '',
                      worktreeId: entry.worktreeId,
                    })
                  }
                  send(socket, {
                    id: message.id,
                    payload: {
                      activeTabId: sessionActiveTabIds.get(sessionId) ?? null,
                      tabs,
                    },
                    type: 'listTabsResult',
                  })
                  logDebug('daemon.request.listTabs', { sessionId, tabs: tabs.length })
                  break
                }
                case 'disposeAll': {
                  const sessionId = attachedSessions.get(socket)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  if (sessionId != null && sessionId !== '') {
                    for (const [tabId, entry] of tabRegistry) {
                      if (entry.sessionId === sessionId) tabRegistry.delete(tabId)
                    }
                    sessionActiveTabIds.delete(sessionId)
                    sessionDimensions.delete(sessionId)
                    await manager.disposeSession(sessionId)
                  }
                  sendOk(socket, message.id)
                  break
                }
                case 'ping':
                  sendOk(socket, message.id)
                  break
                case 'prepareReexec': {
                  // No version check needed: the requester observed the
                  // `hotReexec` capability before sending this. The handler
                  // itself enforces draining=false to keep concurrent
                  // requests from corrupting the handoff.
                  await handleReexecRequest(socket, message.id, message.payload.reason)
                  break
                }
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              logDebug('daemon.request.error', {
                error: errorMessage,
                requestId: message.id,
                type: message.type,
              })
              send(socket, { id: message.id, payload: { message: errorMessage }, type: 'error' })
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logDebug('daemon.decoder.error', { error: message })
          decoder.reset()
          send(socket, { id: crypto.randomUUID(), payload: { message }, type: 'error' })
        }
      })()
    })

    socket.on('close', () => {
      logDebug('daemon.client.close', { sessionId: attachedSessions.get(socket) ?? null })
      sockets.delete(socket)
      attachedSessions.delete(socket)
      negotiatedVersions.delete(socket)
      if (sockets.size === 0) updateTmBroadcastForClientCount(0)
    })
    socket.on('error', () => {
      logDebug('daemon.client.error', { sessionId: attachedSessions.get(socket) ?? null })
      sockets.delete(socket)
      attachedSessions.delete(socket)
      negotiatedVersions.delete(socket)
      if (sockets.size === 0) updateTmBroadcastForClientCount(0)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  tightenSocketPermissions(socketPath)

  // Sidecar files let bystander processes detect "is the daemon running and
  // what version is it?" without a handshake. Required by the hot-reexec
  // path in bootstrap.ts (Ring 3).
  try {
    writeDaemonPidFile(process.pid)
    writeDaemonVersionFile(getProcessVersion())
  } catch (error) {
    logDebug('daemon.sidecars.writeFailed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  let draining = false
  // The renamed socket path is captured during drain so the shutdown handler
  // can unlink the dirent (the listening fd still pins the inode until close;
  // the dirent at daemon.old.sock would otherwise linger after exit).
  let renamedSocketPath: string | null = null

  type DrainOutcome =
    | { ok: true; handoffPath: string; renamedSocketPath: string }
    | { ok: false; message: string }

  /**
   * Hot-reexec drain. Called by either an IPC `prepareReexec` request or
   * by `kill -USR2 <pid>`. We:
   *   1. Write the handoff sidecar so the successor can tell it was spawned
   *      as a reexec target (not a fresh boot).
   *   2. Rename the listening socket out of the canonical path. The OS keeps
   *      the original inode pinned by our listening fd, so existing client
   *      sockets stay live; the canonical path is freed for the successor
   *      to bind. A new dirent appears at daemon.old.sock.
   *   3. Stop accepting new client connections (`server.close()` only
   *      refuses new conns; existing sockets keep ferrying until they idle).
   *   4. Schedule shutdown on a short grace so any final replies flush and
   *      clients observe socket close (their reconnect logic interprets it
   *      as "daemon went away — try again," landing on the successor).
   *
   * Returns the outcome so the caller can send an ack (or error) over
   * whatever channel is appropriate — an IPC socket or nothing at all.
   */
  const drainAndHandoff = async (reason: string | undefined): Promise<DrainOutcome> => {
    if (draining) {
      return { message: 'Daemon is already draining for reexec', ok: false }
    }
    draining = true
    logDebug('daemon.reexec.start', { pid: process.pid, reason: reason ?? null })

    const oldSocketPath = getDaemonOldSocketPath()
    // Clear any stale dirent from a previous botched reexec.
    if (existsSync(oldSocketPath)) {
      try {
        unlinkSync(oldSocketPath)
      } catch {
        // best-effort
      }
    }

    let handoffPath: string
    try {
      handoffPath = writeDaemonHandoff({
        fromPid: process.pid,
        fromProcessVersion: getProcessVersion(),
        renamedSocketPath: oldSocketPath,
        version: 1,
        writtenAt: Date.now(),
      })
    } catch (error) {
      draining = false
      const message = error instanceof Error ? error.message : String(error)
      logDebug('daemon.reexec.handoffWriteFailed', { error: message })
      return { message: `Handoff file write failed: ${message}`, ok: false }
    }

    try {
      renameSync(socketPath, oldSocketPath)
      renamedSocketPath = oldSocketPath
    } catch (error) {
      draining = false
      // Clean up the handoff file we just wrote — the successor must not see
      // a stale handoff if reexec didn't actually start.
      try {
        unlinkSync(handoffPath)
      } catch {
        // best-effort
      }
      const message = error instanceof Error ? error.message : String(error)
      logDebug('daemon.reexec.renameFailed', { error: message })
      return { message: `Socket rename failed: ${message}`, ok: false }
    }

    // Refuse new connections from now on; the successor will bind the
    // canonical path.
    server.close()
    logDebug('daemon.reexec.drained', { handoffPath, renamedSocketPath: oldSocketPath })

    // Give any in-flight replies a beat to flush, then bow out. Use the
    // same shutdown path as a SIGTERM so hookServer/manager are torn down
    // cleanly. `setTimeout` keeps the event loop alive long enough.
    setTimeout(() => gracefulShutdown('reexec'), 250)

    return { handoffPath, ok: true, renamedSocketPath: oldSocketPath }
  }

  const handleReexecRequest = async (
    requester: Socket,
    requestId: string,
    reason: string | undefined
  ): Promise<void> => {
    const outcome = await drainAndHandoff(reason)
    if (!outcome.ok) {
      send(requester, {
        id: requestId,
        payload: { message: outcome.message },
        type: 'error',
      })
      return
    }
    send(requester, {
      id: requestId,
      payload: {
        handoffPath: outcome.handoffPath,
        renamedSocketPath: outcome.renamedSocketPath,
      },
      type: 'reexecAck',
    })
    logDebug('daemon.reexec.ack', {
      handoffPath: outcome.handoffPath,
      renamedSocketPath: outcome.renamedSocketPath,
    })
  }

  const gracefulShutdown = (signal: string) => {
    logDebug(`daemon.${signal}`)
    statusLoop.stop()
    if (hookServer) {
      void hookServer.stop()
      try {
        if (existsSync(hookUrlFilePath)) unlinkSync(hookUrlFilePath)
      } catch (error) {
        logDebug('daemon.hookServer.urlFileCleanupFailed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    manager.destroy()
    server.close()
    // Unlink the renamed-away socket dirent if we drained. Without this it
    // lingers at daemon.old.sock as a dead AF_UNIX inode the next reexec
    // would have to clean up itself.
    if (renamedSocketPath !== null && existsSync(renamedSocketPath)) {
      try {
        unlinkSync(renamedSocketPath)
      } catch (error) {
        logDebug('daemon.reexec.oldSocketUnlinkFailed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // Sidecars: any bystander (harness, CLI) that reads daemon.pid /
    // daemon.version between our exit and the successor's writeDaemonPidFile
    // would see the predecessor's now-dead PID. Strip those on every
    // shutdown; reexec additionally preserves daemon.handoff.json so the
    // successor can log the takeover, while a regular shutdown strips the
    // lot.
    if (signal === 'reexec') {
      removeDaemonSidecarsForReexec()
    } else {
      removeDaemonSidecars()
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => gracefulShutdown('sigterm'))
  process.on('SIGINT', () => gracefulShutdown('sigint'))
  process.on('SIGUSR2', () => {
    // Out-of-band drain trigger. Useful for `kill -USR2 <pid>` debugging or
    // when a caller wants to nudge the daemon without negotiating a hello
    // first. No IPC partner is waiting for a reply — we call the drain
    // directly instead of forging a fake Socket.
    logDebug('daemon.signal.sigusr2')
    void (async () => {
      const outcome = await drainAndHandoff('sigusr2')
      if (!outcome.ok) {
        logDebug('daemon.signal.sigusr2.drainFailed', { message: outcome.message })
      }
    })()
  })

  process.on('uncaughtException', (error) => {
    logDebug('daemon.uncaughtException', { error: error.message, stack: error.stack })
    gracefulShutdown('uncaughtException')
  })

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    logDebug('daemon.unhandledRejection', { error: message, stack })
    gracefulShutdown('unhandledRejection')
  })

  await new Promise<void>(() => {
    // Keep the daemon process alive until it is terminated.
  })
}
