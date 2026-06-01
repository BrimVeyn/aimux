import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'

import type { AssistantId, TerminalSnapshot } from '../state/types'

import { logDebug } from '../debug/input-log'
import { type ClaudeHookServer, startClaudeHookServer } from '../integrations/claude-hook-server'
import {
  type ClientRequest,
  encodeMessage,
  getProcessVersion,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  negotiateProtocolVersion,
  parseClientRequest,
  type ServerEvent,
  type ServerResponse,
} from '../ipc/protocol'
import { findSocketProcessPid, spawnDetachedTerminalManager } from '../platform/daemon-control'
import { type LoopTabView, runStatusDetectionLoop } from '../pty/assistant-status-detection-loop'
import { TerminalManagerClient } from '../terminal-manager/manager-client'
import {
  getClaudeHookUrlFilePath,
  getIpcDaemonSocketPath,
  getSocketSecurityIssue,
  getTerminalManagerSocketPath,
  removeDaemonSocketIfExists,
  removeTerminalManagerSocketIfExists,
  tightenSocketPermissions,
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
  allocateSeq: () => number
): DaemonTabEntry {
  const existing = registry.get(tabId)
  const viewport = existing?.viewport ?? initialViewport
  const entry: DaemonTabEntry = {
    assistant,
    command,
    sessionId,
    viewport,
    viewportSeq: existing?.viewportSeq ?? (viewport ? allocateSeq() : 0),
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
  logDebug('daemon.start', { pid: process.pid, socketPath })

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
  let nextViewportSeq = 1

  const allocateSeq = (): number => nextViewportSeq++
  const rememberTab = (
    sessionId: string,
    tabId: string,
    assistant: AssistantId,
    command: string,
    initialViewport?: TerminalSnapshot
  ): void => {
    const before = tabRegistry.get(tabId)
    const entry = mergeTabRegistryEntry(
      tabRegistry,
      sessionId,
      tabId,
      assistant,
      command,
      initialViewport,
      allocateSeq
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
                  send(socket, {
                    id: message.id,
                    payload: {
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
                  })
                  const negotiatedVersion = requireNegotiatedVersion(socket, negotiatedVersions)
                  if (message.payload.protocolVersion !== negotiatedVersion) {
                    throw new Error(
                      `Protocol mismatch: client v${message.payload.protocolVersion}, daemon v${negotiatedVersion}`
                    )
                  }

                  attachedSessions.set(socket, message.payload.sessionId)
                  const attachResult = await manager.attachSession({
                    cols: message.payload.cols,
                    rows: message.payload.rows,
                    sessionId: message.payload.sessionId,
                    workspaceSnapshot: message.payload.workspaceSnapshot,
                  })
                  for (const tab of attachResult.tabs) {
                    rememberTab(
                      message.payload.sessionId,
                      tab.id,
                      tab.assistant,
                      tab.command,
                      tab.viewport
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
                  logDebug('daemon.request.createTab.start', {
                    command: message.payload.command,
                    sessionId,
                    tabId: message.payload.tabId,
                    title: message.payload.title,
                  })
                  rememberTab(
                    sessionId,
                    message.payload.tabId,
                    message.payload.assistant,
                    [message.payload.command, ...(message.payload.args ?? [])].join(' ')
                  )
                  // Inject the hook bridge env so Claude Code's hooks can
                  // call back into our status loop. Safe to add for every
                  // assistant: non-Claude binaries simply ignore the vars.
                  // We pass the URL *file path*, not the URL itself, so the
                  // bridge can pick up a fresh URL after a daemon restart
                  // even on PTYs that outlive this daemon process.
                  const env: Record<string, string> = { AIMUX_PANE_ID: message.payload.tabId }
                  if (hookServer) env.AIMUX_HOOK_URL_FILE = hookUrlFilePath
                  await manager.createTab({ ...message.payload, env, sessionId })
                  sendOk(socket, message.id)
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
                  await manager.setActiveTab(sessionId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'closeTab': {
                  const sessionId = requireSession(socket, attachedSessions)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  tabRegistry.delete(message.payload.tabId)
                  await manager.closeTab(sessionId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'disposeAll': {
                  const sessionId = attachedSessions.get(socket)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  if (sessionId != null && sessionId !== '') {
                    for (const [tabId, entry] of tabRegistry) {
                      if (entry.sessionId === sessionId) tabRegistry.delete(tabId)
                    }
                    await manager.disposeSession(sessionId)
                  }
                  sendOk(socket, message.id)
                  break
                }
                case 'ping':
                  sendOk(socket, message.id)
                  break
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
    process.exit(0)
  }

  process.on('SIGTERM', () => gracefulShutdown('sigterm'))
  process.on('SIGINT', () => gracefulShutdown('sigint'))

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
