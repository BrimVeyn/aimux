import { existsSync } from 'node:fs'

import { getIpcDaemonSocketPath } from '../../daemon/runtime-paths'
import { spawnDetachedIpcDaemon } from '../../platform/daemon-control'
import { DaemonClient } from './daemon-client'

interface ConnectOptions {
  /** When true (default), spawn the daemon if the socket is missing. */
  autostart?: boolean
}

const SPAWN_BACKOFF_MS = 300
const SPAWN_ATTEMPTS = 10

/**
 * Connect to the daemon, spawning it if necessary. Matches the UI's bootstrap
 * but stripped of the breaking-update path — a CLI invocation is not the
 * right place to surface "your binary is out of date" UX.
 *
 * Returns a connected, handshake-completed `DaemonClient`.
 */
export async function connectToDaemon(options: ConnectOptions = {}): Promise<DaemonClient> {
  const autostart = options.autostart !== false
  const socketPath = getIpcDaemonSocketPath()

  if (existsSync(socketPath)) {
    try {
      return await DaemonClient.connect(socketPath)
    } catch (error) {
      if (!autostart) throw error
      // Fall through to spawn — the socket exists but the daemon is wedged.
    }
  }

  if (!autostart) {
    throw new Error(`daemon socket missing: ${socketPath}`)
  }

  const spawned = await spawnDetachedIpcDaemon()
  if (!spawned) {
    throw new Error('failed to start aimux daemon')
  }

  let lastError: unknown
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    try {
      return await DaemonClient.connect(socketPath)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, SPAWN_BACKOFF_MS))
    }
  }

  throw new Error(
    `daemon spawned but unreachable after ${SPAWN_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}
