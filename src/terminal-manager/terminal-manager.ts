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

  sessionManager.on('render', (sessionId, tabId, viewport, terminalModes) => {
    const event: ManagerEvent = {
      payload: { sessionId, tabId, terminalModes, viewport },
      type: 'tabRender',
    }
    for (const socket of sockets) {
      send(socket, event)
    }
  })
  sessionManager.on('exit', (sessionId, tabId, exitCode) => {
    const event: ManagerEvent = { payload: { exitCode, sessionId, tabId }, type: 'tabExit' }
    for (const socket of sockets) {
      send(socket, event)
    }
  })
  sessionManager.on('error', (sessionId, tabId, message) => {
    const event: ManagerEvent = { payload: { message, sessionId, tabId }, type: 'tabError' }
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
                  rows: message.payload.rows,
                  sessionId: message.payload.sessionId,
                  snapshotTabs: message.payload.workspaceSnapshot?.tabs.length ?? 0,
                })
                const negotiatedVersion = requireNegotiatedVersion(socket, negotiatedVersions)
                if (message.payload.protocolVersion !== negotiatedVersion) {
                  throw new Error(
                    `Manager protocol mismatch: client v${message.payload.protocolVersion}, server v${negotiatedVersion}`
                  )
                }
                sessionManager.resize(
                  message.payload.sessionId,
                  message.payload.cols,
                  message.payload.rows
                )
                const attachResult = sessionManager.attachSession(
                  message.payload.sessionId,
                  message.payload.workspaceSnapshot
                )
                send(socket, {
                  id: message.id,
                  payload: { protocolVersion: negotiatedVersion, ...attachResult },
                  type: 'attachResult',
                })
                logDebug('terminalManager.request.attach.success', {
                  activeTabId: attachResult.activeTabId,
                  sessionId: message.payload.sessionId,
                  tabs: attachResult.tabs.length,
                })
                break
              }
              case 'createTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                logDebug('terminalManager.request.createTab.start', {
                  command: message.payload.command,
                  sessionId: message.payload.sessionId,
                  tabId: message.payload.tabId,
                  title: message.payload.title,
                })
                sessionManager.createTab(message.payload.sessionId, message.payload)
                sendOk(socket, message.id)
                logDebug('terminalManager.request.createTab.success', {
                  sessionId: message.payload.sessionId,
                  tabId: message.payload.tabId,
                })
                break
              case 'write':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.write(
                  message.payload.sessionId,
                  message.payload.tabId,
                  message.payload.data
                )
                sendOk(socket, message.id)
                break
              case 'resizeClient': {
                requireNegotiatedVersion(socket, negotiatedVersions)
                const intentsRecord = message.payload.intents
                const intentsMap = intentsRecord
                  ? new Map(Object.entries(intentsRecord))
                  : undefined
                sessionManager.resize(
                  message.payload.sessionId,
                  message.payload.cols,
                  message.payload.rows,
                  intentsMap
                )
                sendOk(socket, message.id)
                break
              }
              case 'resizeTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.resizeTab(
                  message.payload.sessionId,
                  message.payload.tabId,
                  message.payload.cols,
                  message.payload.rows,
                  message.payload.intent
                )
                sendOk(socket, message.id)
                break
              case 'scroll':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.scroll(
                  message.payload.sessionId,
                  message.payload.tabId,
                  message.payload.deltaLines
                )
                sendOk(socket, message.id)
                break
              case 'scrollToBottom':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.scrollToBottom(message.payload.sessionId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              case 'reapplyScrollIntent':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.reapplyScrollIntent(
                  message.payload.sessionId,
                  message.payload.tabId,
                  message.payload.intent
                )
                sendOk(socket, message.id)
                break
              case 'setActiveTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.setActiveTab(message.payload.sessionId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              case 'closeTab':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.closeTab(message.payload.sessionId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              case 'disposeSession':
                requireNegotiatedVersion(socket, negotiatedVersions)
                sessionManager.disposeSession(message.payload.sessionId)
                sendOk(socket, message.id)
                break
              case 'ping':
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
    })
    socket.on('error', () => {
      logDebug('terminalManager.client.error')
      sockets.delete(socket)
      negotiatedVersions.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  tightenSocketPermissions(socketPath)

  const gracefulShutdown = (signal: string) => {
    logDebug(`terminalManager.${signal}`)
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
