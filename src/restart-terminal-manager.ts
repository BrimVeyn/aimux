import {
  getTerminalManagerSocketPath,
  removeTerminalManagerSocketIfExists,
} from './daemon/runtime-paths'
import {
  findIpcDaemonPid,
  findTerminalManagerPid,
  killProcess,
  spawnDetachedTerminalManager,
} from './platform/daemon-control'

export async function runRestartTerminalManager(): Promise<number> {
  const socketPath = getTerminalManagerSocketPath()

  const daemonPid = await findIpcDaemonPid()
  if (daemonPid !== null) {
    process.stdout.write(`Stopping IPC daemon (pid ${daemonPid})...\n`)
    await killProcess(daemonPid)
  }

  const managerPid = await findTerminalManagerPid()
  if (managerPid !== null) {
    process.stdout.write(
      `WARNING: killing terminal-manager (pid ${managerPid}) will kill live sessions.\n`
    )
    await killProcess(managerPid)
    process.stdout.write('Terminal-manager stopped.\n')
  } else {
    process.stdout.write('No running terminal-manager found.\n')
  }

  removeTerminalManagerSocketIfExists()

  process.stdout.write('Starting terminal-manager...\n')
  const ok = await spawnDetachedTerminalManager()

  if (ok) {
    process.stdout.write(`Terminal-manager started on ${socketPath}.\n`)
    return 0
  }

  process.stderr.write('Failed to start terminal-manager.\n')
  return 1
}
