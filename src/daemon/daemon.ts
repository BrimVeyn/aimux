import { createServer, type Socket } from 'node:net'

import { logDebug } from '../debug/input-log'
import {
  encodeMessage,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseClientRequest,
  type ClientRequest,
  type ServerEvent,
  type ServerResponse,
} from '../ipc/protocol'
import { findDaemonPid } from '../platform/daemon-control'
import {
  getDaemonSocketPath,
  removeDaemonSocketIfExists,
  tightenDaemonSocketPermissions,
} from './runtime-paths'
import { SessionManager } from './session-manager'

function send(socket: Socket, message: ServerResponse | ServerEvent): void {
  socket.write(encodeMessage(message))
}

function sendOk(socket: Socket, id: string): void {
  send(socket, { id, type: 'ok', payload: {} })
}

function requireSession(socket: Socket, attachedSessions: Map<Socket, string>): string {
  const sessionId = attachedSessions.get(socket)
  if (!sessionId) {
    throw new Error('No session attached')
  }
  return sessionId
}

export async function runDaemon(): Promise<void> {
  const socketPath = getDaemonSocketPath()
  logDebug('daemon.start', { socketPath, pid: process.pid })

  const existingPid = await findDaemonPid(socketPath)
  if (existingPid !== null && existingPid !== process.pid) {
    logDebug('daemon.alreadyRunning', { existingPid })
    process.stderr.write(`aimux daemon already running (pid ${existingPid})\n`)
    process.exit(1)
  }

  logDebug('daemon.removeStaleSocket', { socketPath })
  removeDaemonSocketIfExists()

  const sessionManager = new SessionManager()
  const sockets = new Set<Socket>()
  const attachedSessions = new Map<Socket, string>()

  sessionManager.on('render', (sessionId, tabId, viewport, terminalModes) => {
    const event: ServerEvent = { type: 'tabRender', payload: { tabId, viewport, terminalModes } }
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event)
      }
    }
  })
  sessionManager.on('exit', (sessionId, tabId, exitCode) => {
    const event: ServerEvent = { type: 'tabExit', payload: { tabId, exitCode } }
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event)
      }
    }
  })
  sessionManager.on('error', (sessionId, tabId, message) => {
    const event: ServerEvent = { type: 'tabError', payload: { tabId, message } }
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
      try {
        for (const message of decoder.push(chunk)) {
          try {
            logDebug('daemon.request', { type: message.type, id: message.id })
            switch (message.type) {
              case 'attach': {
                attachedSessions.set(socket, message.payload.sessionId)
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
                  type: 'attachResult',
                  payload: { protocolVersion: IPC_PROTOCOL_VERSION, ...attachResult },
                })
                break
              }
              case 'createTab': {
                const sessionId = requireSession(socket, attachedSessions)
                sessionManager.createTab(sessionId, message.payload)
                sendOk(socket, message.id)
                break
              }
              case 'write': {
                const sessionId = requireSession(socket, attachedSessions)
                sessionManager.write(sessionId, message.payload.tabId, message.payload.data)
                sendOk(socket, message.id)
                break
              }
              case 'resizeClient': {
                const sessionId = requireSession(socket, attachedSessions)
                sessionManager.resize(sessionId, message.payload.cols, message.payload.rows)
                sendOk(socket, message.id)
                break
              }
              case 'scroll': {
                const sessionId = requireSession(socket, attachedSessions)
                sessionManager.scroll(sessionId, message.payload.tabId, message.payload.deltaLines)
                sendOk(socket, message.id)
                break
              }
              case 'scrollToBottom': {
                const sessionId = requireSession(socket, attachedSessions)
                sessionManager.scrollToBottom(sessionId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              }
              case 'setActiveTab': {
                const sessionId = requireSession(socket, attachedSessions)
                sessionManager.setActiveTab(sessionId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              }
              case 'closeTab': {
                const sessionId = requireSession(socket, attachedSessions)
                sessionManager.closeTab(sessionId, message.payload.tabId)
                sendOk(socket, message.id)
                break
              }
              case 'disposeAll': {
                const sessionId = attachedSessions.get(socket)
                if (sessionId) {
                  sessionManager.disposeSession(sessionId)
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
            logDebug('daemon.request.error', { error: errorMessage, requestId: message.id })
            send(socket, { id: message.id, type: 'error', payload: { message: errorMessage } })
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logDebug('daemon.request.error', { error: message })
        decoder.reset()
        send(socket, { id: crypto.randomUUID(), type: 'error', payload: { message } })
      }
    })

    socket.on('close', () => {
      logDebug('daemon.client.close')
      sockets.delete(socket)
      attachedSessions.delete(socket)
    })
    socket.on('error', () => {
      logDebug('daemon.client.error')
      sockets.delete(socket)
      attachedSessions.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  tightenDaemonSocketPermissions(socketPath)
  logDebug('daemon.listening', { socketPath })

  const gracefulShutdown = (signal: string) => {
    logDebug(`daemon.${signal}`)
    sessionManager.disposeAll()
    server.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => gracefulShutdown('sigterm'))
  process.on('SIGINT', () => gracefulShutdown('sigint'))

  process.on('uncaughtException', (error) => {
    logDebug('daemon.uncaughtException', { error: error.message, stack: error.stack })
    sessionManager.disposeAll()
    server.close()
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    logDebug('daemon.unhandledRejection', { error: message, stack })
    sessionManager.disposeAll()
    server.close()
    process.exit(1)
  })

  await new Promise<void>(() => {
    // Keep the daemon process alive until it is terminated.
  })
}
