import { negotiateDaemonReexec, waitForSocketRemoval } from './daemon/reexec-client'
import { getDaemonSocketPath, removeDaemonSocketIfExists } from './daemon/runtime-paths'
import {
  findIpcDaemonPid,
  killProcess,
  spawnDaemonReexec,
  spawnDetachedIpcDaemon,
} from './platform/daemon-control'

export async function runRestartDaemon(): Promise<number> {
  const socketPath = getDaemonSocketPath()
  const pid = await findIpcDaemonPid()

  // Prefer hot-reexec when explicitly enabled — keeps the terminal-manager
  // and every PTY alive. Fall back to brute restart on any failure so the
  // command remains reliable.
  const reexecEnabled = process.env.AIMUX_HOT_REEXEC === '1'
  if (reexecEnabled && pid !== null) {
    process.stdout.write(`Negotiating hot-reexec with daemon (pid ${pid})...\n`)
    const negotiation = await negotiateDaemonReexec(socketPath, { reason: 'restart-daemon' })
    if (negotiation.ok) {
      await waitForSocketRemoval(socketPath, 2_000)
      process.stdout.write('Spawning successor daemon...\n')
      const ok = await spawnDaemonReexec()
      if (ok) {
        process.stdout.write(`Daemon hot-reexec complete on ${socketPath}. PTYs preserved.\n`)
        return 0
      }
      process.stderr.write('Successor daemon failed to bind; falling back to full restart.\n')
    } else {
      process.stdout.write(`Hot-reexec not available (${negotiation.reason}); falling back.\n`)
    }
  }

  // Re-resolve the daemon pid: the negotiation above may have already
  // drained the predecessor, which exits ~250ms after ack. Using the pre-
  // negotiation pid to killProcess risks signalling an unrelated process
  // that recycled that PID on a busy host.
  const livePid = await findIpcDaemonPid()
  if (livePid !== null) {
    process.stdout.write(`Stopping IPC daemon (pid ${livePid})...\n`)
    await killProcess(livePid)
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
