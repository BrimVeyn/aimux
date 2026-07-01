import { existsSync } from 'node:fs'
import { connect } from 'node:net'

import { getDaemonSocketPath, removeDaemonSocketIfExists } from './daemon/runtime-paths'
import { MANAGER_PROTOCOL_MIN_VERSION } from './ipc/manager-protocol'
import {
  encodeMessage,
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseServerMessage,
} from './ipc/protocol'
import {
  findIpcDaemonPid,
  killProcess,
  spawnDaemonReexec,
  spawnDetachedIpcDaemon,
} from './platform/daemon-control'

/**
 * Negotiates a clean hot-reexec with the daemon at `socketPath`. Resolves
 * `true` when the daemon acked the drain (it will then exit on its own and
 * the canonical socket path is free for a successor binary). Resolves
 * `false` on any failure mode — caller falls back to the brute restart.
 */
async function negotiateReexec(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect(socketPath)
    const decoder = new MessageDecoder(parseServerMessage)
    const helloId = crypto.randomUUID()
    const reexecId = crypto.randomUUID()
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), 5_000)
    socket.once('error', () => finish(settled))
    socket.once('connect', () => {
      socket.write(
        encodeMessage({
          id: helloId,
          payload: { maxVersion: IPC_PROTOCOL_VERSION, minVersion: IPC_PROTOCOL_MIN_VERSION },
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
              finish(false)
              return
            }
            if (!message.payload.capabilities.includes(IPC_CAPABILITY_HOT_REEXEC)) {
              finish(false)
              return
            }
            // If the successor daemon's MANAGER_PROTOCOL_MIN_VERSION > what
            // the live TM speaks, the successor will crash before binding.
            // Bail early so the caller falls straight through to brute
            // restart instead of paying the 250ms drain + 2s bind-wait for a
            // guaranteed-failed reexec.
            const managerSelected = message.payload.managerSelectedVersion
            if (managerSelected === undefined || managerSelected < MANAGER_PROTOCOL_MIN_VERSION) {
              finish(false)
              return
            }
            socket.write(
              encodeMessage({
                id: reexecId,
                payload: { reason: 'restart-daemon' },
                type: 'prepareReexec',
              })
            )
            continue
          }
          if (message.id === reexecId) {
            finish(message.type === 'reexecAck')
            return
          }
        }
      } catch {
        finish(false)
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

export async function runRestartDaemon(): Promise<number> {
  const socketPath = getDaemonSocketPath()
  const pid = await findIpcDaemonPid()

  // Prefer hot-reexec when explicitly enabled — keeps the terminal-manager
  // and every PTY alive. Fall back to brute restart on any failure so the
  // command remains reliable.
  const reexecEnabled = process.env.AIMUX_HOT_REEXEC === '1'
  if (reexecEnabled && pid !== null) {
    process.stdout.write(`Negotiating hot-reexec with daemon (pid ${pid})...\n`)
    if (await negotiateReexec(socketPath)) {
      await waitForSocketRemoval(socketPath, 2_000)
      process.stdout.write('Spawning successor daemon...\n')
      const ok = await spawnDaemonReexec()
      if (ok) {
        process.stdout.write(`Daemon hot-reexec complete on ${socketPath}. PTYs preserved.\n`)
        return 0
      }
      process.stderr.write('Successor daemon failed to bind; falling back to full restart.\n')
    } else {
      process.stdout.write('Hot-reexec not available; falling back to full restart.\n')
    }
  }

  if (pid !== null) {
    process.stdout.write(`Stopping IPC daemon (pid ${pid})...\n`)
    await killProcess(pid)
    process.stdout.write('IPC daemon stopped.\n')
  } else {
    process.stdout.write('No running IPC daemon found.\n')
  }

  removeDaemonSocketIfExists()

  process.stdout.write('Starting IPC daemon...\n')
  const ok = await spawnDetachedIpcDaemon()

  if (ok) {
    process.stdout.write(`IPC daemon started on ${socketPath}.\n`)
    return 0
  }

  process.stderr.write('Failed to start IPC daemon.\n')
  return 1
}
