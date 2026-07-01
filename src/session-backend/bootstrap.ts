import { existsSync } from 'node:fs'
import { connect } from 'node:net'

import type { SessionBackend } from './types'

import {
  getIpcDaemonSocketPath,
  getSocketSecurityIssue,
  removeDaemonSocketIfExists,
  removeTerminalManagerSocketIfExists,
} from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'
import { MANAGER_PROTOCOL_MIN_VERSION } from '../ipc/manager-protocol'
import {
  encodeMessage,
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseServerMessage,
} from '../ipc/protocol'
import {
  findIpcDaemonPid,
  findTerminalManagerPid,
  killProcess,
  spawnDaemonReexec,
  spawnDetachedIpcDaemon,
} from '../platform/daemon-control'
import { LocalSessionBackend } from './local-session-backend'
import { RemoteSessionBackend } from './remote-session-backend'

interface DaemonHandshakeProbeResult {
  compatible: boolean
  error?: string
  processVersion?: string
  selectedVersion?: number
  /**
   * Capabilities the daemon advertised during the hello phase. Empty for
   * legacy daemons that predate the capability field. Used to gate the
   * hot-reexec attempt — we only send `prepareReexec` to a daemon that
   * advertises `hotReexec`.
   */
  capabilities?: readonly string[]
  /**
   * Manager-protocol version the daemon negotiated with the running TM.
   * Undefined when the daemon hasn't reached the TM yet or predates the
   * field. Bootstrap uses this to skip hot-reexec when the successor's
   * MANAGER_PROTOCOL_MIN_VERSION would be higher than the live TM speaks.
   */
  managerSelectedVersion?: number
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
  if (securityIssue != null && securityIssue !== '') {
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
  if (securityIssue != null && securityIssue !== '') {
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
    let daemonCapabilities: readonly string[] = []
    let daemonManagerSelectedVersion: number | undefined
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
            daemonCapabilities = message.payload.capabilities
            daemonManagerSelectedVersion = message.payload.managerSelectedVersion

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
              capabilities: daemonCapabilities,
              compatible,
              error: compatible
                ? undefined
                : `attach returned protocol v${message.payload.protocolVersion}`,
              managerSelectedVersion: daemonManagerSelectedVersion,
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

/**
 * Ask the running daemon to drain and rename its socket out of the way, then
 * spawn the new daemon binary in its place. The terminal-manager (and every
 * PTY it owns) stays alive throughout. Returns `true` if the swap succeeded
 * AND the successor handshakes compatibly. On any failure the caller should
 * fall through to the legacy restart path.
 *
 * Behind `AIMUX_HOT_REEXEC=1`. Only viable when the running daemon advertises
 * the `hotReexec` capability — older daemons predate the wire and would
 * respond with an unknown-request error.
 */
async function attemptHotReexec(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect(socketPath)
    const decoder = new MessageDecoder(parseServerMessage)
    const helloId = crypto.randomUUID()
    const reexecId = crypto.randomUUID()
    let settled = false

    const finish = (success: boolean, reason: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      logDebug('backend.reexec.finish', { reason, success })
      resolve(success)
    }

    const timer = setTimeout(() => finish(false, 'timeout'), 5_000)

    socket.once('error', (error: NodeJS.ErrnoException) => {
      // ECONNRESET / EPIPE during drain is expected if the daemon already
      // closed the socket after the ack flushed. Treat the prior reexecAck
      // as authoritative; that observation is captured below.
      finish(settled, error.message)
    })
    socket.once('connect', () => {
      socket.write(
        encodeMessage({
          id: helloId,
          payload: {
            maxVersion: IPC_PROTOCOL_VERSION,
            minVersion: IPC_PROTOCOL_MIN_VERSION,
          },
          type: 'hello',
        })
      )
    })
    socket.on('data', (chunk) => {
      try {
        for (const message of decoder.push(chunk)) {
          if (!('id' in message)) continue
          if (message.id === helloId) {
            if (message.type !== 'helloResult') {
              finish(false, `hello: ${message.type}`)
              return
            }
            if (!message.payload.capabilities.includes(IPC_CAPABILITY_HOT_REEXEC)) {
              finish(false, 'daemon does not advertise hotReexec')
              return
            }
            socket.write(
              encodeMessage({
                id: reexecId,
                payload: { reason: 'protocol-mismatch' },
                type: 'prepareReexec',
              })
            )
            continue
          }
          if (message.id === reexecId) {
            if (message.type === 'reexecAck') {
              logDebug('backend.reexec.ack', {
                handoffPath: message.payload.handoffPath,
                renamedSocketPath: message.payload.renamedSocketPath,
              })
              // The daemon has renamed its socket away and is about to exit.
              // We can't keep using this socket — close it cleanly and let
              // the caller spawn the successor.
              finish(true, 'ack received')
              return
            }
            finish(false, `prepareReexec: ${message.type}`)
            return
          }
        }
      } catch (error) {
        finish(false, error instanceof Error ? error.message : String(error))
      }
    })
  })
}

async function waitForSocketRemoval(socketPath: string, deadlineMs = 2_000): Promise<boolean> {
  const stop = Date.now() + deadlineMs
  while (Date.now() < stop) {
    if (!existsSync(socketPath)) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

async function hotReexecAndRespawn(socketPath: string): Promise<boolean> {
  if (!(await attemptHotReexec(socketPath))) {
    return false
  }
  // Old daemon renamed the canonical path away; wait for the dirent to be
  // unbound (it should already be — rename is atomic) before spawning.
  await waitForSocketRemoval(socketPath, 1_000)
  return spawnDaemonReexec()
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
    // Ring 3: prefer hot-reexec over the legacy stopTM+restart path when
    // the running daemon advertises `hotReexec` and the operator has opted
    // in via AIMUX_HOT_REEXEC=1. The terminal-manager and every PTY stay
    // alive; the daemon binary swaps under them — no session-loss prompt.
    const reexecEnabled = process.env.AIMUX_HOT_REEXEC === '1'
    const daemonSupportsReexec =
      handshake.capabilities?.includes(IPC_CAPABILITY_HOT_REEXEC) ?? false
    // If the successor daemon's MANAGER_PROTOCOL_MIN_VERSION > what the
    // running TM negotiated, the reexec is doomed: the successor will crash
    // in ensureTerminalManagerReady() before binding the canonical socket.
    // A legacy daemon that predates managerSelectedVersion returns undefined
    // — treat that as "unknown, don't try" to avoid a 2-second wasted round-
    // trip on a rolling upgrade that also bumps the manager protocol.
    const managerCompatible =
      handshake.managerSelectedVersion !== undefined &&
      handshake.managerSelectedVersion >= MANAGER_PROTOCOL_MIN_VERSION
    if (reexecEnabled && daemonSupportsReexec && managerCompatible) {
      logDebug('backend.create.tryReexec', { socketPath })
      const reexecOk = await hotReexecAndRespawn(socketPath)
      if (reexecOk) {
        const afterReexec = await probeDaemonProtocolCompatibility(socketPath)
        logDebug('backend.create.handshakeAfterReexec', {
          compatible: afterReexec.compatible,
          error: afterReexec.error ?? null,
          processVersion: afterReexec.processVersion ?? null,
          selectedVersion: afterReexec.selectedVersion ?? null,
          socketPath,
        })
        if (afterReexec.compatible) {
          logDebug('backend.create.remote', { reexec: true, socketPath })
          return new RemoteSessionBackend()
        }
        // Reexec succeeded but the successor still mismatches. This is the
        // partial-update / PATH-skew case: the on-disk binary that spawned
        // as the successor disagrees with what this process is running.
        // Legacy stopTM+restart is exactly the recovery path — a fresh TM
        // + a full daemon restart re-pin both protocols against the same
        // binary. Fall through instead of throwing.
        logDebug('backend.create.reexec.fallback', {
          error: afterReexec.error ?? 'incompatible protocol',
          reason: 'post-reexec handshake still mismatches',
        })
      } else {
        logDebug('backend.create.reexec.fallback', { reason: 'reexec attempt failed' })
      }
    } else if (reexecEnabled && daemonSupportsReexec && !managerCompatible) {
      logDebug('backend.create.reexec.skipped', {
        managerSelectedVersion: handshake.managerSelectedVersion ?? null,
        minRequired: MANAGER_PROTOCOL_MIN_VERSION,
        reason: 'manager-protocol-mismatch',
      })
    }

    // We're about to kill the terminal-manager and every PTY — warn the UI
    // now so the user isn't surprised. The hot-reexec branch above never
    // reaches this point, so the callback fires only when sessions really
    // do die.
    await opts?.onBreakingUpdateRequired?.()

    // AIMUX_ALLOW_KILL_PTYS: legacy breaking-update fallback. Ring 3 of
    // docs/developer/hot-migration-plan.md replaces this with daemon
    // hot-reexec so PTYs survive the upgrade. Until then, killing the TM is
    // the only way to clear a daemon↔TM protocol mismatch.
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
