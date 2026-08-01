import { createServer, type Socket } from 'node:net'

import {
  getTerminalManagerSocketPath,
  removeTerminalManagerSocketIfExists,
  tightenSocketPermissions,
} from '../daemon/runtime-paths'
import { SessionManager } from '../daemon/session-manager'
import { logDebug } from '../debug/input-log'
import {
  createManagerHelloResult,
  encodeManagerMessage,
  type ManagerEvent,
  type ManagerRequest,
  type ManagerResponse,
  MessageDecoder,
  parseManagerRequest,
  selectManagerProtocolVersion,
} from '../ipc/manager-protocol'
import { findSocketProcessPid } from '../platform/daemon-control'

function send(socket: Socket, message: ManagerResponse | ManagerEvent): void {
  socket.write(encodeManagerMessage(message))
}

function sendOk(socket: Socket, id: string): void {
  send(socket, { id, payload: {}, type: 'ok' })
}

function requireNegotiatedVersion(socket: Socket, versions: Map<Socket, number>): number {
  const version = versions.get(socket)
  if (version === undefined) {
    throw new Error('Protocol handshake required before using terminal manager')
  }
  return version
}

export async function runTerminalManager(): Promise<void> {
  const socketPath = getTerminalManagerSocketPath()
  logDebug('terminalManager.start', { pid: process.pid, socketPath })

  const existingPid = await findSocketProcessPid(socketPath)
  if (existingPid !== null && existingPid !== process.pid) {
    logDebug('terminalManager.alreadyRunning', { existingPid })
    process.stderr.write(`aimux terminal manager already running (pid ${existingPid})\n`)
    process.exit(1)
  }

  removeTerminalManagerSocketIfExists()

  const sessionManager = new SessionManager()
  const sockets = new Set<Socket>()
  const negotiatedVersions = new Map<Socket, number>()

  /**
   * Auto-exit when fully idle: no clients connected AND no live PTY sessions.
   * Prevents the "zombie TM" pattern where a stale terminal-manager from an
   * older install keeps consuming CPU after the user has closed everything.
   * The grace window allows brief reconnects (e.g. daemon restart during
   * `aimux update`) without killing the process.
   *
   * Set AIMUX_TM_IDLE_EXIT_MS=0 to disable.
   */
  const idleExitMs = (() => {
    const raw = process.env.AIMUX_TM_IDLE_EXIT_MS
    if (raw === undefined) return 60_000
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60_000
  })()
  let idleExitTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleIdleExitIfApplicable = (): void => {
    if (idleExitMs === 0) return
    if (idleExitTimer !== null) return
    if (sockets.size > 0) return
    if (sessionManager.hasAnySessions()) return
    logDebug('terminalManager.idleExit.schedule', { idleExitMs })
    idleExitTimer = setTimeout(() => {
      idleExitTimer = null
      if (sockets.size > 0 || sessionManager.hasAnySessions()) {
        logDebug('terminalManager.idleExit.cancelled')
        return
      }
      logDebug('terminalManager.idleExit.fire')
      sessionManager.disposeAll()
      // Graceful: drop the listening socket so the file is unlinked, matching
      // SIGTERM/SIGINT shutdown. Bail-out timer guards against close() hanging
      // on a bad socket.
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 1_000).unref?.()
    }, idleExitMs)
    idleExitTimer.unref?.()
  }

  // A session can exit naturally (PTY child finishes) while no client is
  // attached — re-evaluate idle state in that case too.
  sessionManager.on('exit', () => scheduleIdleExitIfApplicable())

  sessionManager.on('render', (projectId, tabId, viewport, terminalModes) => {
    const event: ManagerEvent = {
      payload: { projectId, tabId, terminalModes, viewport },
      type: 'tabRender',
    }
    for (const socket of sockets) {
      send(socket, event)
    }
  })
  sessionManager.on('exit', (projectId, tabId, exitCode) => {
    const event: ManagerEvent = { payload: { exitCode, projectId, tabId }, type: 'tabExit' }
    for (const socket of sockets) {
      send(socket, event)
    }
  })
  sessionManager.on('error', (projectId, tabId, message) => {
    const event: ManagerEvent = { payload: { message, projectId, tabId }, type: 'tabError' }
    for (const socket of sockets) {
      send(socket, event)
    }
  })

  const server = createServer((socket) => {
    logDebug('terminalManager.client.connected')
    sockets.add(socket)
    const decoder = new MessageDecoder<ManagerRequest>(parseManagerRequest)

    socket.on('data', (chunk) => {
      try {
        for (const message of decoder.push(chunk)) {
          try {
            switch (message.type) {
              case 'hello': {
                logDebug('terminalManager.request.hello', {
                  maxVersion: message.payload.maxVersion,
                  minVersion: message.payload.minVersion,
                })
                const selectedVersion = selectManagerProtocolVersion(message.payload)
                if (selectedVersion === null) {
                  send(socket, {
                    id: message.id,
                    payload: { message: 'No compatible terminal-manager protocol version' },
                    type: 'error',
                  })
                  break
                }

                negotiatedVersions.set(socket, selectedVersion)
                logDebug('terminalManager.request.hello.success', { selectedVersion })
                send(socket, {
                  id: message.id,
                  payload: createManagerHelloResult(selectedVersion),
                  type: 'helloResult',
                })
                break
              }
              case 'attachSession': {
                logDebug('terminalManager.request.attach.start', {
                  cols: message.payload.cols,
                  projectId: message.payload.projectId,
                  rows: message.payload.rows,
                  snapshotTabs: message.payload.projectSnapshot?.tabs.length ?? 0,
                })
                const negotiatedVersion = requireNegotiatedVersion(socket, negotiatedVersions)
                if (message.payload.protocolVersion !== negotiatedVersion) {
                  throw new Error(
                    `Manager protocol mismatch: client v${message.payload.protocolVersion}, server v${negotiatedVersion}`
                  )
                }
                sessionManager.resize(
                  message.payload.projectId,
                  message.payload.cols,
                  message.payload.rows
                )
                const attachResult = sessionManager.attachSession(
                  message.payload.projectId,
                  message.payload.projectSnapshot
                )
                send(socket, {
                  id: message.id,
                  payload: { protocolVersion: negotiatedVersion, ...attachResult },
                  type: 'attachResult',
                })
                logDebug('terminalManager.request.attach.success', {
                  activeTabId: attachResult.activeTabId,
                  projectId: message.payload.projectId,
                  tabs: attachResult.tabs.length,
                })
                break
              }
              case 'createTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                logDebug('terminalManager.request.createTab.start', {
                  command: message.payload.command,
                  projectId: message.payload.projectId,
                  tabId: message.payload.tabId,
                  title: message.payload.title,
                })
                sessionManager.createTab(message.payload.projectId, message.payload)
                sendOk(socket, message.id)
                logDebug('terminalManager.request.createTab.success', {
                  projectId: message.payload.projectId,
                  tabId: message.payload.tabId,
                })
                break
              case 'write':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.write(
                  message.payload.projectId,
                  message.payload.tabId,
                  message.payload.data
                )
                sendOk(socket, message.id)
                break
              case 'updateTabMetadata':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.updateTabMetadata(
                  message.payload.projectId,
                  message.payload.tabId,
                  message.payload
                )
                sendOk(socket, message.id)
                break
              case 'resizeClient': {
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.resize(
                  message.payload.projectId,
                  message.payload.cols,
                  message.payload.rows
                )
                sendOk(socket, message.id)
                break
              }
              case 'resizeTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.resizeTab(
                  message.payload.projectId,
                  message.payload.tabId,
                  message.payload.cols,
                  message.payload.rows
                )
                sendOk(socket, message.id)
                break
              case 'scroll':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.scroll(
                  message.payload.projectId,
                  message.payload.tabId,
                  message.payload.deltaLines
                )
                sendOk(socket, message.id)
                break
              case 'scrollToBottom':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.scrollToBottom(message.payload.projectId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              case 'setActiveTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.setActiveTab(message.payload.projectId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              case 'closeTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.closeTab(message.payload.projectId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              case 'disposeSession':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.disposeSession(message.payload.projectId)
                sendOk(socket, message.id)
                break
              case 'ping':
                sendOk(socket, message.id)
                break
              case 'setBroadcastEnabled':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.setBroadcastEnabled(message.payload.enabled)
                sendOk(socket, message.id)
                break
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logDebug('terminalManager.request.error', {
              error: errorMessage,
              requestId: message.id,
              type: message.type,
            })
            send(socket, { id: message.id, payload: { message: errorMessage }, type: 'error' })
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logDebug('terminalManager.decoder.error', { error: message })
        decoder.reset()
        send(socket, { id: crypto.randomUUID(), payload: { message }, type: 'error' })
      }
    })

    socket.on('close', () => {
      logDebug('terminalManager.client.close')
      sockets.delete(socket)
      negotiatedVersions.delete(socket)
      scheduleIdleExitIfApplicable()
    })
    socket.on('error', () => {
      logDebug('terminalManager.client.error')
      sockets.delete(socket)
      negotiatedVersions.delete(socket)
      scheduleIdleExitIfApplicable()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  tightenSocketPermissions(socketPath)

  // First idle eval: if no client connects within idleExitMs of startup, exit.
  scheduleIdleExitIfApplicable()

  const gracefulShutdown = (signal: string) => {
    logDebug(`terminalManager.${signal}`)
    if (idleExitTimer) clearTimeout(idleExitTimer)
    sessionManager.disposeAll()
    server.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => gracefulShutdown('sigterm'))
  process.on('SIGINT', () => gracefulShutdown('sigint'))
  process.on('uncaughtException', () => gracefulShutdown('uncaughtException'))
  process.on('unhandledRejection', () => gracefulShutdown('unhandledRejection'))

  await new Promise<void>(() => {
    // Keep the terminal-manager process alive until it is terminated.
  })
}
