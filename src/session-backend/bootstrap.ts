import { connect } from 'node:net'

import type { SessionBackend } from './types'

import {
  getIpcDaemonSocketPath,
  getSocketSecurityIssue,
  removeDaemonSocketIfExists,
  removeTerminalManagerSocketIfExists,
} from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import {
  encodeMessage,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseServerMessage,
} from '../ipc/protocol'
import {
  findIpcDaemonPid,
  findTerminalManagerPid,
  killProcess,
  spawnDetachedIpcDaemon,
} from '../platform/daemon-control'
import { LocalSessionBackend } from './local-session-backend'
import { RemoteSessionBackend } from './remote-session-backend'

interface DaemonHandshakeProbeResult {
  compatible: boolean
  error?: string
  processVersion?: string
  selectedVersion?: number
}

async function spawnDaemon(): Promise<void> {
  logDebug('backend.spawnDaemon.start', {
    execPath: process.execPath,
    socketPath: getIpcDaemonSocketPath(),
  })
  const ok = await spawnDetachedIpcDaemon()
  if (ok) {
    logDebug('backend.spawnDaemon.ready', { socketPath: getIpcDaemonSocketPath() })
    return
  }

  throw new Error(`IPC daemon unavailable at ${getIpcDaemonSocketPath()}`)
}

async function canConnectToDaemon(socketPath: string): Promise<boolean> {
  const securityIssue = getSocketSecurityIssue(socketPath)
  if (securityIssue) {
    logDebug('backend.healthcheck.socketIssue', { issue: securityIssue, socketPath })
    return false
  }

  return await new Promise<boolean>((resolve) => {
    const socket = connect(socketPath)
    const finish = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.once('connect', () => finish(true))
    socket.once('error', (error: NodeJS.ErrnoException) => {
      logDebug('backend.healthcheck.error', {
        code: error.code ?? 'unknown',
        error: error.message,
        socketPath,
      })
      finish(false)
    })
  })
}

export async function probeDaemonProtocolCompatibility(
  socketPath: string
): Promise<DaemonHandshakeProbeResult> {
  const securityIssue = getSocketSecurityIssue(socketPath)
  if (securityIssue) {
    return { compatible: false, error: securityIssue }
  }

  return await new Promise<DaemonHandshakeProbeResult>((resolve) => {
    const socket = connect(socketPath)
    const decoder = new MessageDecoder(parseServerMessage)
    const helloRequestId = crypto.randomUUID()
    const attachRequestId = crypto.randomUUID()
    const disposeRequestId = crypto.randomUUID()
    const probeSessionId = `probe-${crypto.randomUUID()}`
    let daemonProcessVersion: string | undefined
    let settled = false
    const timer = setTimeout(() => {
      finish({ compatible: false, error: 'handshake timed out' })
    }, 2_000)

    const finish = (result: DaemonHandshakeProbeResult) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.once('connect', () => {
      socket.write(
        encodeMessage({
          id: helloRequestId,
          payload: {
            maxVersion: IPC_PROTOCOL_VERSION,
            minVersion: IPC_PROTOCOL_MIN_VERSION,
          },
          type: 'hello',
        })
      )
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish({ compatible: false, error: error.message })
    })
    socket.on('data', (chunk) => {
      try {
        for (const message of decoder.push(chunk)) {
          if (!('id' in message)) {
            continue
          }

          if (message.id === helloRequestId) {
            if (message.type !== 'helloResult') {
              finish({
                compatible: false,
                error:
                  message.type === 'error' ? message.payload.message : `unexpected ${message.type}`,
              })
              return
            }

            daemonProcessVersion = message.payload.processVersion

            socket.write(
              encodeMessage({
                id: attachRequestId,
                payload: {
                  cols: 80,
                  protocolVersion: message.payload.selectedVersion,
                  rows: 24,
                  sessionId: probeSessionId,
                },
                type: 'attach',
              })
            )
            return
          }

          if (message.id === attachRequestId) {
            if (message.type !== 'attachResult') {
              finish({
                compatible: false,
                error:
                  message.type === 'error' ? message.payload.message : `unexpected ${message.type}`,
              })
              return
            }

            const compatible =
              message.payload.protocolVersion >= IPC_PROTOCOL_MIN_VERSION &&
              message.payload.protocolVersion <= IPC_PROTOCOL_VERSION

            socket.write(
              encodeMessage({
                id: disposeRequestId,
                payload: {},
                type: 'disposeAll',
              })
            )
            finish({
              compatible,
              error: compatible
                ? undefined
                : `attach returned protocol v${message.payload.protocolVersion}`,
              processVersion: daemonProcessVersion,
              selectedVersion: message.payload.protocolVersion,
            })
            return
          }

          if (message.id === disposeRequestId) {
            continue
          }
        }
      } catch (error) {
        finish({
          compatible: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  })
}

async function restartDaemon(socketPath: string): Promise<void> {
  const pid = await findIpcDaemonPid()
  if (pid !== null) {
    logDebug('backend.restartDaemon.killing', { pid, socketPath })
    await killProcess(pid)
  }
  removeDaemonSocketIfExists()
  await spawnDaemon()
}

// Kill the terminal-manager and clear its socket so the restarted daemon
// spawns a fresh one via ensureTerminalManagerReady. Without this, the new
// daemon reconnects to the still-running old terminal-manager and the
// breaking protocol mismatch persists.
async function stopTerminalManager(): Promise<void> {
  const pid = await findTerminalManagerPid()
  if (pid !== null) {
    logDebug('backend.stopTerminalManager.killing', { pid })
    await killProcess(pid)
  }
  removeTerminalManagerSocketIfExists()
}

export async function createSessionBackend(opts?: {
  onBreakingUpdateRequired?: () => Promise<void>
}): Promise<SessionBackend> {
  if (process.env.AIMUX_LOCAL_BACKEND === '1') {
    logDebug('backend.create.localExplicit')
    return new LocalSessionBackend()
  }

  const socketPath = getIpcDaemonSocketPath()
  const initialReachable = await canConnectToDaemon(socketPath)
  logDebug('backend.create.start', { initialReachable, socketPath })

  if (!initialReachable) {
    removeDaemonSocketIfExists()
    await spawnDaemon()
  }

  const reachable = await canConnectToDaemon(socketPath)
  if (!reachable) {
    throw new Error(`IPC daemon unavailable at ${socketPath}`)
  }

  const handshake = await probeDaemonProtocolCompatibility(socketPath)
  logDebug('backend.create.handshake', {
    compatible: handshake.compatible,
    error: handshake.error ?? null,
    processVersion: handshake.processVersion ?? null,
    selectedVersion: handshake.selectedVersion ?? null,
    socketPath,
  })
  if (!handshake.compatible) {
    logDebug('backend.create.restartForHandshake', {
      error: handshake.error ?? 'incompatible daemon handshake',
      socketPath,
    })
    await opts?.onBreakingUpdateRequired?.()
    await stopTerminalManager()
    await restartDaemon(socketPath)
    const retriedHandshake = await probeDaemonProtocolCompatibility(socketPath)
    logDebug('backend.create.handshakeAfterRestart', {
      compatible: retriedHandshake.compatible,
      error: retriedHandshake.error ?? null,
      processVersion: retriedHandshake.processVersion ?? null,
      selectedVersion: retriedHandshake.selectedVersion ?? null,
      socketPath,
    })
    if (!retriedHandshake.compatible) {
      throw new Error(
        `IPC daemon handshake failed after restart: ${retriedHandshake.error ?? 'incompatible protocol'}`
      )
    }
  }

  logDebug('backend.create.remote', { socketPath })
  return new RemoteSessionBackend()
}
