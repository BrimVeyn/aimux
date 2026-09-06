import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'

import type {
  AssistantId,
  TabSession,
  TabStatus,
  TerminalSnapshot,
  WorkspaceRecord,
} from '../state/types'

import { version as APP_VERSION } from '../../package.json'
import { initialAutoRenameStatus } from '../auto-rename/coordinator'
import { builtinPlugins } from '../builtin-plugins'
import { loadUserConfig } from '../config/loader'
import { logDebug } from '../debug/input-log'
import { type HookServer, startHookServer } from '../integrations/hook-server'
import { MANAGER_CAPABILITY_WORKER_METADATA } from '../ipc/manager-protocol'
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
import { runPluginMigrations } from '../plugins/migrations'
import {
  PLUGIN_CONTROL_EVENT,
  PLUGIN_CONTROL_EVENTS_SUBSCRIBE,
  PLUGIN_CONTROL_ID,
} from '../plugins/rpc-envelope'
import { PromptObserver } from '../prompts/prompt-observer'
import { type LoopTabView, runStatusDetectionLoop } from '../pty/assistant-status-detection-loop'
import { lastNonBlankLine } from '../pty/last-line'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import { TerminalManagerClient } from '../terminal-manager/manager-client'
import {
  addWorkspaceToCatalog,
  assertProjectInCatalog,
  bumpLastOpenedInCatalog,
  createProjectInCatalog,
  deleteFromCatalog,
  removeWorkspaceFromCatalog,
} from './catalog-writer'
import { emitDaemonEvent, onDaemonEvent } from './daemon-events'
import { DAEMON_EVENT_NAMES, type DaemonPluginHost, startDaemonPluginHost } from './plugin-host'
import { createDaemonContextExtender } from './plugin-services'
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
  projectId: string
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
  workspaceId?: string
  workerName?: string
  autoRenameStatus?: 'eligible' | 'attempted'
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
  projectId: string,
  tabId: string,
  assistant: AssistantId,
  command: string,
  initialViewport: TerminalSnapshot | undefined,
  allocateSeq: () => number,
  metadata?: {
    title?: string
    status?: TabStatus
    workspaceId?: string
    workerName?: string
    autoRenameStatus?: 'eligible' | 'attempted'
  }
): DaemonTabEntry {
  const existing = registry.get(tabId)
  const viewport = existing?.viewport ?? initialViewport
  const preserveAttemptedMetadata = existing?.autoRenameStatus === 'attempted'
  const entry: DaemonTabEntry = {
    assistant,
    autoRenameStatus: preserveAttemptedMetadata
      ? 'attempted'
      : (metadata?.autoRenameStatus ?? existing?.autoRenameStatus),
    command,
    projectId,
    status: metadata?.status ?? existing?.status,
    title: preserveAttemptedMetadata ? existing.title : (metadata?.title ?? existing?.title),
    viewport,
    viewportSeq: existing?.viewportSeq ?? (viewport ? allocateSeq() : 0),
    workerName: metadata?.workerName ?? existing?.workerName,
    workspaceId: metadata?.workspaceId ?? existing?.workspaceId,
  }
  registry.set(tabId, entry)
  return entry
}

export function findWorkerNameConflict(
  registry: ReadonlyMap<string, DaemonTabEntry>,
  projectId: string,
  workerName: string
): string | undefined {
  for (const [tabId, entry] of registry) {
    if (entry.projectId === projectId && entry.workerName === workerName) return tabId
  }
  return undefined
}

/**
 * Turn-complete settle window for the status loop, overridable via
 * `AIMUX_TURN_SETTLE_MS` for slow/loaded machines. Falls back to the loop's
 * own default when unset or non-numeric.
 */
function turnCompleteSettleMs(): number | undefined {
  const raw = process.env.AIMUX_TURN_SETTLE_MS
  if (raw == null || raw === '') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function send(socket: Socket, message: ServerResponse | ServerEvent): void {
  socket.write(encodeMessage(message))
}

function sendOk(socket: Socket, id: string): void {
  send(socket, { id, payload: {}, type: 'ok' })
}

function requireProject(socket: Socket, attachedProjects: Map<Socket, string>): string {
  const projectId = attachedProjects.get(socket)
  if (!(projectId != null && projectId !== '')) {
    throw new Error('No project attached')
  }
  return projectId
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
  const { resolved: resolvedConfig } = await loadUserConfig()
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
  const attachedProjects = new Map<Socket, string>()
  const negotiatedVersions = new Map<Socket, number>()
  // Sockets that attached with `thin: true` (headless CLIs). Used to
  // distinguish "a UI is attached" from "only CLIs are talking to me" when
  // deciding whether project/workspace mutations go via broadcast (UI does
  // the write) or via catalog-writer (daemon does the write).
  const thinAttachers = new Set<Socket>()
  // Sockets that asked for the daemon's events as NDJSON — `aimux events
  // follow`. Thin by nature, so `broadcastPluginEvent` never reaches them;
  // this is the one fanout that does.
  const eventFollowers = new Set<Socket>()

  /**
   * `tab:added` carries a whole `TabSession`; on the wire to a shell script
   * the scrollback and the viewport are dead weight. Everything else passes
   * through as the plugin bus sees it.
   */
  const slimEventPayload = (payload: unknown): unknown => {
    if (typeof payload !== 'object' || payload === null) return payload
    const record = payload as Record<string, unknown>
    if (typeof record.tab !== 'object' || record.tab === null) return payload
    const { buffer: _buffer, viewport: _viewport, ...tab } = record.tab as Record<string, unknown>
    return { ...record, tab }
  }
  const forwardEventToFollowers = (event: string, payload: unknown): void => {
    if (eventFollowers.size === 0) return
    const message: ServerEvent = {
      payload: {
        payload: { at: new Date().toISOString(), event, payload: slimEventPayload(payload) },
        pluginId: PLUGIN_CONTROL_ID,
        verb: PLUGIN_CONTROL_EVENT,
      },
      type: 'pluginEvent',
    }
    for (const socket of eventFollowers) send(socket, message)
  }
  const unfollowEvents = DAEMON_EVENT_NAMES.map((event) =>
    onDaemonEvent(event, (payload) => {
      forwardEventToFollowers(event, payload)
    })
  )

  // Per-tab registry so the status-detection loop can poll every terminal
  // continuously, not just the one the UI is currently attached to.
  const tabRegistry = new Map<string, DaemonTabEntry>()
  // Active tab id per project, populated from attachResult and updated by
  // setActiveTab. Surfaced by `listTabs` so a headless CLI doesn't need to
  // attach just to know which tab the UI is focused on.
  const projectActiveTabIds = new Map<string, string | null>()
  // Last (cols, rows) the project was attached with. `createTab` with
  // cols/rows = 0 falls back to this when the `createTabSizeFallback`
  // capability is in play.
  const projectDimensions = new Map<string, { cols: number; rows: number }>()
  let nextViewportSeq = 1

  const allocateSeq = (): number => nextViewportSeq++
  const rememberTab = (
    projectId: string,
    tabId: string,
    assistant: AssistantId,
    command: string,
    initialViewport?: TerminalSnapshot,
    metadata?: {
      title?: string
      status?: TabStatus
      workspaceId?: string
      workerName?: string
      autoRenameStatus?: 'eligible' | 'attempted'
    }
  ): DaemonTabEntry => {
    const before = tabRegistry.get(tabId)
    const entry = mergeTabRegistryEntry(
      tabRegistry,
      projectId,
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
      projectId,
      resultSeq: entry.viewportSeq,
      tabId,
    })
    return entry
  }

  const broadcastAll = (event: ServerEvent): void => {
    for (const socket of sockets) {
      send(socket, event)
    }
  }

  const broadcastForProject = (projectId: string, event: ServerEvent): void => {
    for (const socket of sockets) {
      if (attachedProjects.get(socket) === projectId) {
        send(socket, event)
      }
    }
  }

  // Fan a server event only to sockets that negotiated a version supporting
  // it. Older peers whose `parseServerMessage` doesn't recognise the type
  // would throw on receipt and drop the connection — MIN_VERSION stays at 10
  // for compat, so we can't rely on every attached socket being v11.
  const broadcastForProjectVersioned = (
    projectId: string,
    minVersion: number,
    event: ServerEvent
  ): void => {
    for (const socket of sockets) {
      if (attachedProjects.get(socket) !== projectId) continue
      const version = negotiatedVersions.get(socket)
      if (version === undefined || version < minVersion) continue
      send(socket, event)
    }
  }

  // Project-scope broadcast: reaches every socket that negotiated at least
  // `minVersion` regardless of which project it's attached to. Project
  // lifecycle events (create/switch/close) target a project that the UI may
  // not currently be attached to, so `broadcastForProjectVersioned` won't do.
  const broadcastAllVersioned = (minVersion: number, event: ServerEvent): void => {
    for (const socket of sockets) {
      const version = negotiatedVersions.get(socket)
      if (version === undefined || version < minVersion) continue
      send(socket, event)
    }
  }

  /**
   * Plugin events reach UI processes only: a thin CLI attacher runs no plugin
   * kernel, and a pre-v19 peer's `parseServerMessage` would throw on the
   * unknown type and drop its connection.
   */
  const broadcastPluginEvent = (event: {
    pluginId: string
    verb: string
    payload?: unknown
  }): void => {
    for (const socket of sockets) {
      if (thinAttachers.has(socket)) continue
      const version = negotiatedVersions.get(socket)
      if (version === undefined || version < 19) continue
      send(socket, { payload: event, type: 'pluginEvent' })
    }
  }

  const applyTabMetadata = (
    tabId: string,
    patch: { title?: string; autoRenameStatus?: 'eligible' | 'attempted' }
  ): void => {
    const entry = tabRegistry.get(tabId)
    if (!entry) return
    if (patch.title !== undefined) entry.title = patch.title
    if (patch.autoRenameStatus !== undefined) entry.autoRenameStatus = patch.autoRenameStatus
    if (patch.title !== undefined) {
      emitDaemonEvent('tab:renamed', { projectId: entry.projectId, tabId, title: patch.title })
    }
    void (async () => {
      try {
        await manager.updateTabMetadata(entry.projectId, tabId, patch)
      } catch (error) {
        logDebug('daemon.tabMetadata.managerFailed', {
          error: error instanceof Error ? error.message : String(error),
          tabId,
        })
      }
    })()
    broadcastForProjectVersioned(entry.projectId, 14, {
      payload: { ...patch, projectId: entry.projectId, tabId },
      type: 'tabMetadataUpdated',
    })
  }

  /**
   * Prompt observation is its own thing now: it watches every tab, and both
   * `tab:prompt` and auto-rename are subscribers. Emitting from inside the
   * coordinator would have meant an event that stops once a tab has a title.
   */
  const prompts = new PromptObserver({
    onPrompt: (tabId, prompt, source) => {
      const entry = tabRegistry.get(tabId)
      if (entry) {
        emitDaemonEvent('tab:prompt', { projectId: entry.projectId, prompt, source, tabId })
      }
    },
  })

  // Count UI attachers so project/workspace handlers can decide whether to
  // relay via broadcast (UI attached → its reducer owns the write) or mutate
  // the catalog directly. A "UI attacher" here is any non-thin attach — thin
  // attachers are CLIs which don't run reducers.
  const countUiAttachers = (): number => {
    let count = 0
    for (const socket of sockets) {
      if (attachedProjects.get(socket) === undefined) continue
      if (thinAttachers.has(socket)) continue
      count++
    }
    return count
  }

  manager.on('render', (projectId, tabId, viewport, terminalModes) => {
    const existing = tabRegistry.get(tabId)
    let newSeq: number | null = null
    if (existing) {
      existing.viewport = viewport
      existing.viewportSeq = nextViewportSeq++
      existing.projectId = projectId
      newSeq = existing.viewportSeq
    }
    logDebug('daemon.manager.render', {
      attachedSocketCount: sockets.size,
      hadRegistryEntry: existing !== undefined,
      newSeq,
      projectId,
      tabId,
      viewportLines: viewport.lines.length,
    })
    const event: ServerEvent = { payload: { tabId, terminalModes, viewport }, type: 'tabRender' }
    broadcastForProject(projectId, event)
  })
  manager.on('exit', (projectId, tabId, exitCode) => {
    logDebug('daemon.manager.exit', { exitCode, projectId, tabId })
    const closing = tabRegistry.get(tabId)
    tabRegistry.delete(tabId)
    if (closing) emitDaemonEvent('tab:closed', { projectId: closing.projectId, tabId })
    if (projectActiveTabIds.get(projectId) === tabId) {
      projectActiveTabIds.set(projectId, null)
    }
    const event: ServerEvent = { payload: { exitCode, tabId }, type: 'tabExit' }
    broadcastForProject(projectId, event)
  })
  manager.on('error', (projectId, tabId, message) => {
    logDebug('daemon.manager.error', { message, projectId, tabId })
    const event: ServerEvent = { payload: { message, tabId }, type: 'tabError' }
    broadcastForProject(projectId, event)
  })

  const listTabsForProject = (projectId: string): LoopTabView[] => {
    const result: LoopTabView[] = []
    for (const [tabId, entry] of tabRegistry) {
      if (entry.projectId !== projectId) continue
      result.push({
        assistant: entry.assistant,
        command: entry.command,
        id: tabId,
        viewport: entry.viewport,
        workspaceId: entry.workspaceId,
      })
    }
    return result
  }

  const statusLoop = runStatusDetectionLoop({
    listProjects: () => {
      const seen = new Set<string>()
      for (const entry of tabRegistry.values()) seen.add(entry.projectId)
      return [...seen]
    },
    listTabs: listTabsForProject,
    onProjectStatus: (projectId, status) => {
      logDebug('daemon.status.project', { projectId, status })
      emitDaemonEvent('project:status', { projectId, status })
      broadcastAll({ payload: { projectId, status }, type: 'projectStatus' })
    },
    onTabQuestion: (tabId, projectId, detail) => {
      logDebug('daemon.status.question', { kind: detail.kind, projectId, tabId })
      emitDaemonEvent('tab:question', {
        kind: detail.kind,
        options: detail.options,
        projectId,
        prompt: detail.prompt,
        tabId,
      })
      // v13 / capability `questionEvents`. Same v13 send-time gate as below.
      broadcastAllVersioned(13, {
        payload: {
          kind: detail.kind,
          options: detail.options,
          projectId,
          prompt: detail.prompt,
          tabId,
        },
        type: 'tabQuestion',
      })
    },
    onTabStatus: (tabId, status, projectId, workspaceId) => {
      logDebug('daemon.status.tab', { projectId, status, tabId })
      emitDaemonEvent('tab:status', { projectId, status, tabId, workspaceId })
      // Broadcast to every client. Clients silently ignore events for tabIds
      // they don't know about, so there's no UI impact — this costs one
      // extra socket write per tab per change, which is trivial, and
      // removes a race where in-flight tab events could be dropped when a
      // client tears down its socket to switch projects.
      broadcastAll({ payload: { projectId, status, tabId, workspaceId }, type: 'tabStatus' })
    },
    onTurnComplete: (tabId, projectId, idleMs, workspaceId) => {
      logDebug('daemon.status.turnComplete', { idleMs, projectId, tabId })
      emitDaemonEvent('tab:turnComplete', { idleMs, projectId, tabId, workspaceId })
      // v13 / capability `turnLifecycle`. Gate at send time — pre-v13 parsers
      // throw on unknown event types and would drop the connection. MIN stays
      // at 10, so we fan this only to peers that negotiated at least v13.
      broadcastAllVersioned(13, {
        payload: { idleMs, projectId, tabId, workspaceId },
        type: 'tabTurnComplete',
      })
    },
    turnSettleMs: turnCompleteSettleMs(),
  })

  // Local HTTP server that receives Claude Code hook callbacks for every PTY
  // spawned by this daemon. We publish its URL to a stable file path that the
  // shipped shell bridge reads on every invocation, so PTYs spawned by a
  // *previous* daemon transparently follow URL changes after a restart.
  // Failure to start is non-fatal — detection falls back to the visual PTY scanner.
  let hookServer: HookServer | null = null
  const hookUrlFilePath = getClaudeHookUrlFilePath()
  try {
    hookServer = startHookServer()
    // Claude registers like anything else. It is the first route rather than a
    // special one, which is what makes a plugin's route the same mechanism.
    hookServer.route('claude', (event) => {
      statusLoop.recordHookEvent({
        hookEventName: event.hookEventName,
        paneId: event.paneId,
        payload: event.payload,
        receivedAt: event.receivedAt,
        source: event.source,
      })
      // `UserPromptSubmit` carries the exact prompt at the exact moment it is
      // submitted, so auto-rename prefers it over reconstructing keystrokes:
      // trust dialogs, menus and completions never produce one.
      if (event.hookEventName === 'UserPromptSubmit') {
        const prompt = event.payload.prompt
        const parentToolUseId = event.payload.parent_tool_use_id
        const fromSubagent = typeof parentToolUseId === 'string' && parentToolUseId.length > 0
        if (typeof prompt === 'string' && !fromSubagent) {
          prompts.observePrompt(event.paneId, prompt)
        }
      }
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

  // Plugin host. Started after the hook server so a daemon plugin can already
  // see a working hook pipeline in its `apply`, and before the socket opens so
  // the `pluginRpc` capability is honest the moment a client can ask for it.
  //
  // Every failure here is contained: a plugin that throws lands in `FAILED`
  // with its error in its own log, and the daemon serves tabs as if it were
  // not there.
  /**
   * Spawns a tab on a plugin's behalf. The same steps the `createTab` request
   * takes, minus the socket: remember the tab first so early render events have
   * metadata to merge into, then create it, then announce it.
   *
   * Size comes from the project's last attached dimensions, because a plugin has
   * no viewport of its own — the same fallback the headless CLI uses, and the
   * same error when no UI has ever attached.
   */
  const spawnTabForPlugin = async (input: {
    projectId: string
    assistant: string
    title: string
    command: string
    args?: string[]
    cwd?: string
    workspaceId?: string
  }): Promise<string> => {
    const dimensions = projectDimensions.get(input.projectId)
    if (!dimensions) {
      throw new Error(
        `no UI has attached to project ${input.projectId} yet, so there is no size to spawn a tab with`
      )
    }
    const tabId = crypto.randomUUID()
    const fullCommand = [input.command, ...(input.args ?? [])].join(' ')
    const autoRenameStatus = initialAutoRenameStatus(
      resolvedConfig.autoRename,
      input.assistant,
      false
    )
    rememberTab(input.projectId, tabId, input.assistant, fullCommand, undefined, {
      autoRenameStatus,
      status: 'starting',
      title: input.title,
      workspaceId: input.workspaceId,
    })
    const env: Record<string, string> = { AIMUX_PANE_ID: tabId }
    if (hookServer) env.AIMUX_HOOK_URL_FILE = hookUrlFilePath
    try {
      await manager.createTab({
        args: input.args,
        assistant: input.assistant,
        autoRenameStatus,
        cols: dimensions.cols,
        command: input.command,
        cwd: input.cwd,
        env,
        projectId: input.projectId,
        rows: dimensions.rows,
        tabId,
        title: input.title,
        workspaceId: input.workspaceId,
      })
    } catch (error) {
      tabRegistry.delete(tabId)
      throw error
    }
    const synthesizedTab: TabSession = {
      activity: 'idle',
      assistant: input.assistant,
      autoRenameStatus,
      buffer: '',
      command: fullCommand,
      id: tabId,
      status: 'starting',
      terminalModes: createDefaultTerminalModes(),
      title: input.title,
      workspaceId: input.workspaceId,
    }
    emitDaemonEvent('tab:added', { projectId: input.projectId, tab: synthesizedTab })
    broadcastForProjectVersioned(input.projectId, 11, {
      payload: { projectId: input.projectId, tab: synthesizedTab },
      type: 'tabAdded',
    })
    return tabId
  }

  /**
   * What `addWorkspaceRecord` / `removeWorkspaceRecord` do, as functions the
   * request handlers and the plugin services share: relayed to the attached
   * UI when there is one — its reducer owns the write — and applied to the
   * catalog directly otherwise.
   */
  const recordWorkspaceAdded = (targetProjectId: string, workspace: WorkspaceRecord): void => {
    emitDaemonEvent('workspace:added', { projectId: targetProjectId, workspace })
    if (countUiAttachers() > 0) {
      broadcastAllVersioned(12, {
        payload: { projectId: targetProjectId, workspace },
        type: 'workspaceAdded',
      })
      logDebug('daemon.request.addWorkspaceRecord.relay', {
        projectId: targetProjectId,
        workspaceId: workspace.id,
      })
    } else {
      addWorkspaceToCatalog(targetProjectId, workspace)
      logDebug('daemon.request.addWorkspaceRecord.direct', {
        projectId: targetProjectId,
        workspaceId: workspace.id,
      })
    }
  }
  const recordWorkspaceRemoved = (targetProjectId: string, workspaceId: string): void => {
    emitDaemonEvent('workspace:removed', { projectId: targetProjectId, workspaceId })
    if (countUiAttachers() > 0) {
      broadcastAllVersioned(12, {
        payload: { projectId: targetProjectId, workspaceId },
        type: 'workspaceRemoved',
      })
      logDebug('daemon.request.removeWorkspaceRecord.relay', {
        projectId: targetProjectId,
        workspaceId,
      })
    } else {
      removeWorkspaceFromCatalog(targetProjectId, workspaceId)
      logDebug('daemon.request.removeWorkspaceRecord.direct', {
        projectId: targetProjectId,
        workspaceId,
      })
    }
  }

  // Before the registry is read: a setting that has moved has to be in its new
  // home by the time anything looks there. Idempotent — the UI calls it too,
  // and neither process can count on starting first.
  runPluginMigrations()

  let pluginHost: DaemonPluginHost | null = null
  try {
    pluginHost = await startDaemonPluginHost({
      broadcast: (event) => {
        broadcastPluginEvent(event)
      },
      builtins: builtinPlugins(resolvedConfig),
      extendContext: createDaemonContextExtender({
        activeTabId: (projectId) => projectActiveTabIds.get(projectId) ?? null,
        closeTab: async (tabId) => {
          const entry = tabRegistry.get(tabId)
          if (!entry) throw new Error(`unknown tab: ${tabId}`)
          await manager.closeTab(entry.projectId, tabId)
        },
        focus: async (projectId, tabId) => manager.setActiveTab(projectId, tabId),
        hookServer: () => hookServer,
        // The same path auto-rename uses, which is the point: a plugin's
        // rename and aimux's own reach the manager, the session and every UI
        // identically, so neither can produce a title the other cannot.
        renameTab: (tabId, title) => {
          // `attempted` alongside the title: a named tab is a named tab,
          // whoever named it, and the next namer must be able to tell.
          applyTabMetadata(tabId, { autoRenameStatus: 'attempted', title })
        },
        spawnTab: spawnTabForPlugin,
        tabs: () => tabRegistry,
        workspaces: {
          addWorkspaceRecord: async (targetProjectId, workspace) => {
            recordWorkspaceAdded(targetProjectId, workspace)
          },
          liveTabs: async (targetProjectId) => listTabsForProject(targetProjectId),
          removeWorkspaceRecord: async (targetProjectId, workspaceId) => {
            recordWorkspaceRemoved(targetProjectId, workspaceId)
          },
          supportsWorkspaceLifecycle: () => true,
        },
        write: async (tabId, data) => {
          const entry = tabRegistry.get(tabId)
          if (!entry) throw new Error(`unknown tab: ${tabId}`)
          await manager.write(entry.projectId, tabId, data)
        },
      }),
      hasUiClient: () => countUiAttachers() > 0,
      userPlugins: resolvedConfig.plugins,
    })
  } catch (error) {
    logDebug('daemon.pluginHost.startFailed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  /**
   * Tell the TM whether to bother snapshotting + broadcasting. Toggled on
   * 0↔1 transitions of the client socket count: when no UI is watching, the
   * TM can skip per-chunk viewport diff/projection work entirely. The TM
   * flushes a fresh snapshot per project on re-enable, so reattaching gives
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
                      appVersion: APP_VERSION,
                      capabilities: [...IPC_PROTOCOL_CAPABILITIES],
                      managerCapabilities: [...manager.getCapabilities()],
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
                    projectId: message.payload.projectId,
                    rows: message.payload.rows,
                    snapshotTabs: message.payload.projectSnapshot?.tabs.length ?? 0,
                    thin: message.payload.thin === true,
                  })
                  const negotiatedVersion = requireNegotiatedVersion(socket, negotiatedVersions)
                  if (message.payload.protocolVersion !== negotiatedVersion) {
                    throw new Error(
                      `Protocol mismatch: client v${message.payload.protocolVersion}, daemon v${negotiatedVersion}`
                    )
                  }

                  attachedProjects.set(socket, message.payload.projectId)
                  if (message.payload.thin === true) {
                    thinAttachers.add(socket)
                  } else {
                    thinAttachers.delete(socket)
                  }
                  // A thin attacher (headless CLI) does not own a viewport, so
                  // it must not resize PTYs on a project a UI is driving. TM's
                  // attachSession always calls `sessionManager.resize` on the
                  // incoming dimensions, so we substitute prior dims (or a
                  // safe default when none exist) before calling it. That
                  // makes the resize a no-op against the current PTY size
                  // instead of clobbering it. We also seed projectDimensions
                  // on first-ever thin attach so `createTab`'s 0×0 fallback
                  // works for headless bootstrap flows (no UI has ever
                  // attached to this project).
                  let attachCols = message.payload.cols
                  let attachRows = message.payload.rows
                  const isThin = message.payload.thin === true
                  if (isThin) {
                    const prior = projectDimensions.get(message.payload.projectId)
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
                      projectDimensions.set(message.payload.projectId, {
                        cols: attachCols,
                        rows: attachRows,
                      })
                      logDebug('daemon.attach.thin.seedDefaultDimensions', {
                        cols: attachCols,
                        projectId: message.payload.projectId,
                        rows: attachRows,
                      })
                    }
                  } else {
                    projectDimensions.set(message.payload.projectId, {
                      cols: message.payload.cols,
                      rows: message.payload.rows,
                    })
                  }
                  const attachResult = await manager.attachSession({
                    cols: attachCols,
                    projectId: message.payload.projectId,
                    projectSnapshot: message.payload.projectSnapshot,
                    rows: attachRows,
                  })
                  projectActiveTabIds.set(message.payload.projectId, attachResult.activeTabId)
                  for (const tab of attachResult.tabs) {
                    rememberTab(
                      message.payload.projectId,
                      tab.id,
                      tab.assistant,
                      tab.command,
                      tab.viewport,
                      {
                        autoRenameStatus: tab.autoRenameStatus,
                        status: tab.status,
                        title: tab.title,
                        workerName: tab.workerName,
                        workspaceId: tab.workspaceId,
                      }
                    )
                  }
                  // Classify synchronously BEFORE sending attachResult so
                  // each tab's activity and the full project-status snapshot
                  // are available to embed in the reply. This makes the
                  // client apply them atomically with `hydrate-project`
                  // and closes the race where separate `tabStatus` events
                  // landed before the tab existed in client state.
                  const tabsForLoop = listTabsForProject(message.payload.projectId)
                  logDebug('daemon.attach.preClassify', {
                    projectId: message.payload.projectId,
                    tabs: tabsForLoop.map((t) => ({
                      assistant: t.assistant,
                      hasViewport: t.viewport !== undefined,
                      id: t.id,
                      seq: tabRegistry.get(t.id)?.viewportSeq ?? null,
                    })),
                  })
                  statusLoop.classifyNow(message.payload.projectId, tabsForLoop)
                  const tabsWithActivity = attachResult.tabs.map((tab) => {
                    const metadata = tabRegistry.get(tab.id)
                    return {
                      ...tab,
                      activity: statusLoop.getTabStatus(tab.id) ?? tab.activity,
                      autoRenameStatus: metadata?.autoRenameStatus ?? tab.autoRenameStatus,
                      title: metadata?.title ?? tab.title,
                      workerName: metadata?.workerName ?? tab.workerName,
                    }
                  })
                  const initialProjectStatuses = statusLoop.snapshotProjects()
                  logDebug('daemon.attach.replay', {
                    projectId: message.payload.projectId,
                    projects: initialProjectStatuses,
                    tabs: tabsWithActivity.map((t) => ({ activity: t.activity, id: t.id })),
                  })
                  send(socket, {
                    id: message.id,
                    payload: {
                      activeTabId: attachResult.activeTabId,
                      initialProjectStatuses,
                      protocolVersion: negotiatedVersion,
                      tabs: tabsWithActivity,
                    },
                    type: 'attachResult',
                  })
                  logDebug('daemon.request.attach.success', {
                    activeTabId: attachResult.activeTabId,
                    projectId: message.payload.projectId,
                    tabs: attachResult.tabs.length,
                  })
                  break
                }
                case 'createTab': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  if (message.payload.workerName !== undefined) {
                    if (!manager.hasCapability(MANAGER_CAPABILITY_WORKER_METADATA)) {
                      throw new Error(
                        'the running terminal manager does not support worker metadata; restart aimux before creating named workers'
                      )
                    }
                    const conflictTabId = findWorkerNameConflict(
                      tabRegistry,
                      projectId,
                      message.payload.workerName
                    )
                    if (conflictTabId !== undefined) {
                      throw new Error(
                        `worker name already exists in this project: ${message.payload.workerName} (${conflictTabId})`
                      )
                    }
                  }
                  // Capability `createTabSizeFallback`: cols/rows = 0 means
                  // "use the project's last attached dimensions". Headless
                  // CLIs don't have a viewport of their own, so this lets
                  // them spawn a PTY that lines up with the UI on the same
                  // project. If we have no remembered size yet, the TM
                  // would receive 0 and spawn a zero-sized PTY — surface a
                  // clear error instead.
                  let cols = message.payload.cols
                  let rows = message.payload.rows
                  if (cols === 0 || rows === 0) {
                    const prior = projectDimensions.get(projectId)
                    if (!prior) {
                      throw new Error(
                        'createTab requested size fallback (cols=0 or rows=0) but no UI has attached to this project yet'
                      )
                    }
                    if (cols === 0) cols = prior.cols
                    if (rows === 0) rows = prior.rows
                  }
                  logDebug('daemon.request.createTab.start', {
                    cols,
                    command: message.payload.command,
                    projectId,
                    rows,
                    sizeFallback: message.payload.cols === 0 || message.payload.rows === 0,
                    tabId: message.payload.tabId,
                    title: message.payload.title,
                  })
                  const fullCommand = [
                    message.payload.command,
                    ...(message.payload.args ?? []),
                  ].join(' ')
                  const autoRenameStatus = initialAutoRenameStatus(
                    resolvedConfig.autoRename,
                    message.payload.assistant,
                    message.payload.autoRenameCandidate === true
                  )
                  rememberTab(
                    projectId,
                    message.payload.tabId,
                    message.payload.assistant,
                    fullCommand,
                    undefined,
                    {
                      autoRenameStatus,
                      status: 'starting',
                      title: message.payload.title,
                      workerName: message.payload.workerName,
                      workspaceId: message.payload.workspaceId,
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
                  // Only the client can see the real terminal, so it sends the
                  // colours a child's OSC probe should be answered with; we do
                  // nothing but hand them to the PTY process.
                  if (message.payload.termColors !== undefined) {
                    env.AIMUX_TERM_COLORS = message.payload.termColors
                  }
                  const {
                    autoRenameCandidate: _autoRenameCandidate,
                    termColors: _termColors,
                    ...managerTabPayload
                  } = message.payload
                  try {
                    await manager.createTab({
                      ...managerTabPayload,
                      autoRenameStatus,
                      cols,
                      env,
                      projectId,
                      rows,
                    })
                  } catch (error) {
                    // `rememberTab` must happen before the manager call so
                    // early render events have metadata to merge into. Undo
                    // that optimistic entry when creation fails, otherwise a
                    // ghost worker name would block a clean retry.
                    tabRegistry.delete(message.payload.tabId)
                    throw error
                  }
                  sendOk(socket, message.id)
                  // Fan a `tabAdded` event only to peers that negotiated at
                  // least v11 — older parsers throw on unknown message types
                  // and would drop the connection. MIN_VERSION stays at 10
                  // for backward compat, so we must gate this at send time.
                  const synthesizedTab: TabSession = {
                    activity: 'idle',
                    assistant: message.payload.assistant,
                    autoRenameStatus,
                    buffer: '',
                    command: fullCommand,
                    id: message.payload.tabId,
                    status: 'starting',
                    terminalModes: createDefaultTerminalModes(),
                    title: message.payload.title,
                    workerName: message.payload.workerName,
                    workspaceId: message.payload.workspaceId,
                  }
                  emitDaemonEvent('tab:added', { projectId, tab: synthesizedTab })
                  broadcastForProjectVersioned(projectId, 11, {
                    payload: { projectId, tab: synthesizedTab },
                    type: 'tabAdded',
                  })
                  logDebug('daemon.request.createTab.success', {
                    projectId,
                    tabId: message.payload.tabId,
                  })
                  break
                }
                case 'write': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.write(projectId, message.payload.tabId, message.payload.data)
                  prompts.observeWrite(message.payload.tabId, message.payload.data)
                  sendOk(socket, message.id)
                  break
                }
                case 'renameTab': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  if (tabRegistry.get(message.payload.tabId)?.projectId !== projectId) {
                    throw new Error(`Tab not found in attached project: ${message.payload.tabId}`)
                  }
                  applyTabMetadata(message.payload.tabId, {
                    autoRenameStatus: 'attempted',
                    title: message.payload.title.trim(),
                  })
                  sendOk(socket, message.id)
                  break
                }
                case 'resizeClient': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  projectDimensions.set(projectId, {
                    cols: message.payload.cols,
                    rows: message.payload.rows,
                  })
                  await manager.resize(projectId, message.payload.cols, message.payload.rows)
                  sendOk(socket, message.id)
                  break
                }
                case 'resizeTab': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.resizeTab(
                    projectId,
                    message.payload.tabId,
                    message.payload.cols,
                    message.payload.rows
                  )
                  sendOk(socket, message.id)
                  break
                }
                case 'scroll': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.scroll(projectId, message.payload.tabId, message.payload.deltaLines)
                  sendOk(socket, message.id)
                  break
                }
                case 'scrollToBottom': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  await manager.scrollToBottom(projectId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'setActiveTab': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  // Update the cache AFTER the TM confirms the change — if
                  // manager.setActiveTab throws (tab doesn't exist, TM
                  // rejects), the cache would otherwise retain the bogus tabId
                  // and a subsequent listTabs would return a stale activeTabId.
                  await manager.setActiveTab(projectId, message.payload.tabId)
                  projectActiveTabIds.set(projectId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'closeTab': {
                  const projectId = requireProject(socket, attachedProjects)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  tabRegistry.delete(message.payload.tabId)
                  emitDaemonEvent('tab:closed', { projectId, tabId: message.payload.tabId })
                  if (projectActiveTabIds.get(projectId) === message.payload.tabId) {
                    projectActiveTabIds.set(projectId, null)
                  }
                  await manager.closeTab(projectId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'listTabs': {
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  const projectId = message.payload.projectId
                  const tabs: TabSessionSummary[] = []
                  for (const [tabId, entry] of tabRegistry) {
                    if (entry.projectId !== projectId) continue
                    tabs.push({
                      activity: statusLoop.getTabStatus(tabId) ?? undefined,
                      assistant: entry.assistant,
                      command: entry.command,
                      id: tabId,
                      // Additive v13 field (capability `listTabsLastLine`): the
                      // tab's last non-blank rendered line, so a fleet poll can
                      // read "what each worker is doing" without a per-tab
                      // snapshot. Undefined when the tab has no viewport yet, in
                      // which case the field is omitted from the JSON wire.
                      lastLine: lastNonBlankLine(entry.viewport),
                      status: entry.status ?? 'running',
                      title: entry.title ?? '',
                      workerName: entry.workerName,
                      workspaceId: entry.workspaceId,
                    })
                  }
                  send(socket, {
                    id: message.id,
                    payload: {
                      activeTabId: projectActiveTabIds.get(projectId) ?? null,
                      tabs,
                    },
                    type: 'listTabsResult',
                  })
                  logDebug('daemon.request.listTabs', { projectId, tabs: tabs.length })
                  break
                }
                case 'disposeAll': {
                  const projectId = attachedProjects.get(socket)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  if (projectId != null && projectId !== '') {
                    for (const [tabId, entry] of tabRegistry) {
                      if (entry.projectId === projectId) {
                        emitDaemonEvent('tab:closed', { projectId, tabId })
                        tabRegistry.delete(tabId)
                      }
                    }
                    projectActiveTabIds.delete(projectId)
                    projectDimensions.delete(projectId)
                    await manager.disposeSession(projectId)
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
                case 'createProject': {
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  const { name, projectPath, switch: doSwitch } = message.payload
                  emitDaemonEvent('project:created', { name, projectPath })
                  if (countUiAttachers() > 0) {
                    // Relay to the UI so it can preserve the live snapshot
                    // of the currently-open project before appending the
                    // new one. Fire-and-forget from the daemon's side.
                    broadcastAllVersioned(12, {
                      payload: { name, projectPath, switch: doSwitch },
                      type: 'projectCreateRequested',
                    })
                    logDebug('daemon.request.createProject.relay', { name, projectPath })
                  } else {
                    const created = createProjectInCatalog(name, projectPath)
                    if (doSwitch === true) {
                      bumpLastOpenedInCatalog(created.id)
                      // Mirror the UI-attached path: an ack event so a
                      // `--wait` CLI can exit even in the headless flow.
                      broadcastAllVersioned(12, {
                        payload: { projectId: created.id },
                        type: 'projectSwitched',
                      })
                    }
                    logDebug('daemon.request.createProject.direct', {
                      name,
                      projectId: created.id,
                    })
                  }
                  sendOk(socket, message.id)
                  break
                }
                case 'switchProject': {
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  const { targetProjectId } = message.payload
                  // Fail fast when the target is unknown — otherwise a UI-
                  // attached `--wait` CLI would sit until timeout while the
                  // UI silently drops the broadcast.
                  assertProjectInCatalog(targetProjectId)
                  if (countUiAttachers() > 0) {
                    broadcastAllVersioned(12, {
                      payload: { targetProjectId },
                      type: 'projectSwitchRequested',
                    })
                    logDebug('daemon.request.switchProject.relay', { targetProjectId })
                  } else {
                    bumpLastOpenedInCatalog(targetProjectId)
                    // No UI to run the switch handler, so the switch is
                    // effectively complete once the catalog reflects it.
                    // Emit the switched event so a --wait CLI can exit.
                    broadcastAllVersioned(12, {
                      payload: { projectId: targetProjectId },
                      type: 'projectSwitched',
                    })
                    logDebug('daemon.request.switchProject.direct', { targetProjectId })
                  }
                  sendOk(socket, message.id)
                  break
                }
                case 'closeProject': {
                  emitDaemonEvent('project:closed', {
                    projectId: message.payload.targetProjectId,
                  })
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  const { targetProjectId } = message.payload
                  assertProjectInCatalog(targetProjectId)
                  if (countUiAttachers() > 0) {
                    broadcastAllVersioned(12, {
                      payload: { targetProjectId },
                      type: 'projectCloseRequested',
                    })
                    logDebug('daemon.request.closeProject.relay', { targetProjectId })
                  } else {
                    deleteFromCatalog(targetProjectId)
                    logDebug('daemon.request.closeProject.direct', { targetProjectId })
                  }
                  sendOk(socket, message.id)
                  break
                }
                case 'announceProjectSwitched': {
                  emitDaemonEvent('project:switched', { projectId: message.payload.projectId })
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  // UI-emitted acknowledgement. Relay so any --wait CLI can
                  // exit. We don't validate that the announcement matches
                  // an outstanding request — a UI can announce a switch that
                  // happened via any means (menu, keybind, CLI).
                  broadcastAllVersioned(12, {
                    payload: { projectId: message.payload.projectId },
                    type: 'projectSwitched',
                  })
                  sendOk(socket, message.id)
                  break
                }
                case 'addWorkspaceRecord': {
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  recordWorkspaceAdded(message.payload.projectId, message.payload.workspace)
                  sendOk(socket, message.id)
                  break
                }
                case 'pluginRequest': {
                  if (
                    message.payload.pluginId === PLUGIN_CONTROL_ID &&
                    message.payload.verb === PLUGIN_CONTROL_EVENTS_SUBSCRIBE
                  ) {
                    // Answered here, not in the host: the host routes by verb
                    // and never sees a socket, and this reply is "yes, *you*".
                    eventFollowers.add(socket)
                    send(socket, {
                      id: message.id,
                      payload: { result: { events: [...DAEMON_EVENT_NAMES], subscribed: true } },
                      type: 'pluginResult',
                    })
                    break
                  }
                  if (!pluginHost) {
                    throw new Error('plugin host is not running in this daemon')
                  }
                  const result = await pluginHost.handleRequest(
                    message.payload.pluginId,
                    message.payload.verb,
                    message.payload.payload
                  )
                  send(socket, { id: message.id, payload: { result }, type: 'pluginResult' })
                  break
                }
                case 'removeWorkspaceRecord': {
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  recordWorkspaceRemoved(message.payload.projectId, message.payload.workspaceId)
                  sendOk(socket, message.id)
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
      logDebug('daemon.client.close', { projectId: attachedProjects.get(socket) ?? null })
      sockets.delete(socket)
      attachedProjects.delete(socket)
      negotiatedVersions.delete(socket)
      thinAttachers.delete(socket)
      eventFollowers.delete(socket)
      if (sockets.size === 0) updateTmBroadcastForClientCount(0)
    })
    socket.on('error', () => {
      logDebug('daemon.client.error', { projectId: attachedProjects.get(socket) ?? null })
      sockets.delete(socket)
      attachedProjects.delete(socket)
      negotiatedVersions.delete(socket)
      thinAttachers.delete(socket)
      eventFollowers.delete(socket)
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
    // One chance for a plugin holding external state to flush it: the process
    // exits a few hundred milliseconds from here.
    emitDaemonEvent('daemon:reexec', { reason })

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
    for (const unfollow of unfollowEvents) unfollow()
    if (pluginHost) void pluginHost.stop()
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
