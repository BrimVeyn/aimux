import { existsSync } from 'node:fs'
import { connect } from 'node:net'

import type { SessionBackend } from './types'

import {
  getDaemonSocketPath,
  getDaemonSocketSecurityIssue,
  removeDaemonSocketIfExists,
} from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import { spawnDetachedDaemon } from '../platform/daemon-control'
import { LocalSessionBackend } from './local-session-backend'
import { RemoteSessionBackend } from './remote-session-backend'

async function spawnDaemon(): Promise<void> {
  logDebug('backend.spawnDaemon.start', {
    socketPath: getDaemonSocketPath(),
    execPath: process.execPath,
  })
  const ok = await spawnDetachedDaemon()
  if (ok) {
    logDebug('backend.spawnDaemon.ready', { socketPath: getDaemonSocketPath() })
    return
  }

  logDebug('backend.spawnDaemon.timeout', { socketPath: getDaemonSocketPath() })
}

async function canConnectToDaemon(socketPath: string): Promise<boolean> {
  const securityIssue = getDaemonSocketSecurityIssue(socketPath)
  if (securityIssue) {
    logDebug('backend.healthcheck.socketIssue', { socketPath, issue: securityIssue })
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
        socketPath,
        code: error.code ?? 'unknown',
        error: error.message,
      })
      finish(false)
    })
  })
}

export async function createSessionBackend(): Promise<SessionBackend> {
  try {
    const socketPath = getDaemonSocketPath()
    const initialReachable = await canConnectToDaemon(socketPath)
    logDebug('backend.create.start', { socketPath, initialReachable })

    if (!initialReachable) {
      removeDaemonSocketIfExists()
      await spawnDaemon()
    }

    const reachable = await canConnectToDaemon(socketPath)
    if (!reachable) {
      throw new Error(`Daemon unavailable at ${socketPath}`)
    }

    logDebug('backend.create.remote', { socketPath })
    return new RemoteSessionBackend()
  } catch (error) {
    logDebug('backend.create.localFallback', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new LocalSessionBackend()
  }
}
