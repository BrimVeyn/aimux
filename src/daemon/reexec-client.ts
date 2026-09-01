import { existsSync } from 'node:fs'
import { connect } from 'node:net'

import { MANAGER_PROTOCOL_MIN_VERSION } from '../ipc/manager-protocol'
import {
  encodeMessage,
  IPC_CAPABILITY_HOT_REEXEC,
  IPC_PROTOCOL_MIN_VERSION,
  IPC_PROTOCOL_VERSION,
  MessageDecoder,
  parseServerMessage,
} from '../ipc/protocol'

export interface NegotiateReexecOptions {
  /**
   * Free-form label sent as `prepareReexec.reason`. Shows up in daemon
   * debug logs so post-mortems can distinguish bootstrap-driven from
   * CLI-driven reexecs.
   */
  reason: string
  /**
   * Overall deadline for the round-trip (connect → hello → prepareReexec
   * → ack). Defaults to 5s, matching the pre-consolidation ad-hoc value.
   */
  timeoutMs?: number
}

export type NegotiateReexecResult =
  | { handoffPath: string; ok: true; renamedSocketPath: string }
  | { ok: false; reason: string }

/**
 * Negotiate a hot-reexec with the daemon at `socketPath`. Resolves once
 * the daemon has acked the drain (it will then exit ~250ms later on its
 * own and free the canonical socket for a successor binary) or a failure
 * mode is detected — the caller falls back to a full restart.
 *
 * Consolidates the previously-duplicated negotiation in bootstrap.ts,
 * restart-daemon.ts, and the manual-reexec-test harness.
 */
export async function negotiateDaemonReexec(
  socketPath: string,
  opts: NegotiateReexecOptions
): Promise<NegotiateReexecResult> {
  const { reason, timeoutMs = 5_000 } = opts
  return new Promise<NegotiateReexecResult>((resolve) => {
    const socket = connect(socketPath)
    const decoder = new MessageDecoder(parseServerMessage)
    const helloId = crypto.randomUUID()
    const reexecId = crypto.randomUUID()
    let settled = false

    const finish = (result: NegotiateReexecResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs)

    socket.once('error', (error: NodeJS.ErrnoException) => {
      // Once we've observed the ack we've already resolved; ECONNRESET /
      // EPIPE during the daemon's drain is expected. Guard on `settled`.
      if (!settled) finish({ ok: false, reason: error.message })
    })
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
              finish({ ok: false, reason: `hello: ${message.type}` })
              return
            }
            if (!message.payload.capabilities.includes(IPC_CAPABILITY_HOT_REEXEC)) {
              finish({ ok: false, reason: 'daemon does not advertise hotReexec' })
              return
            }
            // Successor would fail to speak to the running TM if it needs a
            // newer manager protocol than the TM negotiated. Legacy daemons
            // that predate managerSelectedVersion omit the field — treat
            // that as unknown-and-bail so we don't drain into a doomed
            // reexec.
            const managerSelected = message.payload.managerSelectedVersion
            if (managerSelected === undefined || managerSelected < MANAGER_PROTOCOL_MIN_VERSION) {
              finish({ ok: false, reason: 'manager-protocol mismatch' })
              return
            }
            socket.write(
              encodeMessage({
                id: reexecId,
                payload: { reason },
                type: 'prepareReexec',
              })
            )
            continue
          }
          if (message.id === reexecId) {
            if (message.type === 'reexecAck') {
              finish({
                handoffPath: message.payload.handoffPath,
                ok: true,
                renamedSocketPath: message.payload.renamedSocketPath,
              })
              return
            }
            finish({ ok: false, reason: `prepareReexec: ${message.type}` })
            return
          }
        }
      } catch (error) {
        finish({ ok: false, reason: error instanceof Error ? error.message : String(error) })
      }
    })
  })
}

/**
 * Poll until the canonical daemon socket path no longer exists (the
 * predecessor renamed it away as part of its drain). Returns true once
 * the dirent is gone, false if `deadlineMs` elapses first. Consolidates
 * the poll loop that bootstrap.ts, restart-daemon.ts, and the manual
 * harness each carried a copy of.
 */
export async function waitForSocketRemoval(
  socketPath: string,
  deadlineMs = 2_000
): Promise<boolean> {
  const stop = Date.now() + deadlineMs
  while (Date.now() < stop) {
    if (!existsSync(socketPath)) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}
