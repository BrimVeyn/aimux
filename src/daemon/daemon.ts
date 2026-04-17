import { connect, createServer, type Socket } from 'node:net'

import { logDebug } from '../debug/input-log'
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
import { TerminalManagerClient } from '../terminal-manager/manager-client'
import {
  getIpcDaemonSocketPath,
  getSocketSecurityIssue,
  getTerminalManagerSocketPath,
  removeDaemonSocketIfExists,
  removeTerminalManagerSocketIfExists,
  tightenSocketPermissions,
} from './runtime-paths'

function send(socket: Socket, message: ServerResponse | ServerEvent): void {
  socket.write(encodeMessage(message))
}

function sendOk(socket: Socket, id: string): void {
  send(socket, { id, payload: {}, type: 'ok' })
}

function requireSession(socket: Socket, attachedSessions: Map<Socket, string>): string {
  const sessionId = attachedSessions.get(socket)
  if (!sessionId) {
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
  if (securityIssue) {
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

  manager.on('render', (sessionId, tabId, viewport, terminalModes) => {
    logDebug('daemon.manager.render', {
      attachedSocketCount: sockets.size,
      sessionId,
      tabId,
      viewportLines: viewport.lines.length,
    })
    const event: ServerEvent = { payload: { tabId, terminalModes, viewport }, type: 'tabRender' }
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event)
      }
    }
  })
  manager.on('exit', (sessionId, tabId, exitCode) => {
    logDebug('daemon.manager.exit', { exitCode, sessionId, tabId })
    const event: ServerEvent = { payload: { exitCode, tabId }, type: 'tabExit' }
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event)
      }
    }
  })
  manager.on('error', (sessionId, tabId, message) => {
    logDebug('daemon.manager.error', { message, sessionId, tabId })
    const event: ServerEvent = { payload: { message, tabId }, type: 'tabError' }
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event)
      }
    }
  })

  const server = createServer((socket) => {
    logDebug('daemon.client.connected')
    sockets.add(socket)
    const decoder = new MessageDecoder<ClientRequest>(parseClientRequest)

    socket.on('data', (chunk) => {
      void (async () => {
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
                  send(socket, {
                    id: message.id,
                    payload: {
                      activeTabId: attachResult.activeTabId,
                      protocolVersion: negotiatedVersion,
                      tabs: attachResult.tabs,
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
                  await manager.createTab({ ...message.payload, sessionId })
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
                  await manager.closeTab(sessionId, message.payload.tabId)
                  sendOk(socket, message.id)
                  break
                }
                case 'disposeAll': {
                  const sessionId = attachedSessions.get(socket)
                  requireNegotiatedVersion(socket, negotiatedVersions)
                  if (sessionId) {
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
    })
    socket.on('error', () => {
      logDebug('daemon.client.error', { sessionId: attachedSessions.get(socket) ?? null })
      sockets.delete(socket)
      attachedSessions.delete(socket)
      negotiatedVersions.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  tightenSocketPermissions(socketPath)

  const gracefulShutdown = (signal: string) => {
    logDebug(`daemon.${signal}`)
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
