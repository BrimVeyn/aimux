import { getDaemonSocketPath, removeDaemonSocketIfExists } from './daemon/runtime-paths'
import { findIpcDaemonPid, killProcess, spawnDetachedIpcDaemon } from './platform/daemon-control'

export async function runRestartDaemon(): Promise<number> {
  const socketPath = getDaemonSocketPath()
  const pid = await findIpcDaemonPid()

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
