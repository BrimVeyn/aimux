import { getDaemonSocketPath } from './daemon/runtime-paths'
import { findIpcDaemonPid, findTerminalManagerPid } from './platform/daemon-control'
import { runRestartDaemon } from './restart-daemon'
import {
  fetchLatestNpmVersion,
  getCurrentPackageVersion,
  isNewerVersion,
} from './update/version-check'

export async function runUpdate(): Promise<number> {
  process.stdout.write('Checking for updates...\n')

  // The GitHub release is created before npm publishes, and npm then takes a few
  // minutes to serve every package: null covers both "unreachable" and "not
  // installable yet".
  const latest = await fetchLatestNpmVersion('@brimveyn/aimux')
  if (latest === null) {
    process.stderr.write('No installable release found on npm yet. Try again in a few minutes.\n')
    return 1
  }

  const current = await getCurrentPackageVersion()
  if (!isNewerVersion(latest, current)) {
    process.stdout.write(`Already up to date (${current}).\n`)
    return 0
  }

  process.stdout.write(`Updating aimux ${current} → ${latest}...\n`)

  const remove = Bun.spawn(['bun', 'remove', '-g', 'aimux'], {
    stderr: 'inherit',
    stdout: 'inherit',
  })
  await remove.exited

  const install = Bun.spawn(['bun', 'install', '-g', `@brimveyn/aimux@${latest}`], {
    stderr: 'inherit',
    stdout: 'inherit',
  })

  const exitCode = await install.exited
  if (exitCode !== 0) {
    process.stderr.write('Update failed.\n')
    return 1
  }

  process.stdout.write(`Updated to ${latest}.\n`)

  const pid = await findIpcDaemonPid()
  if (pid !== null) {
    process.stdout.write(`Restarting IPC daemon at ${getDaemonSocketPath()}...\n`)
    await runRestartDaemon()
  }

  // The terminal-manager is intentionally NOT restarted here: doing so kills
  // live AI projects. The flip side: the running TM keeps executing the
  // previous version's code path, so any TM-side fix (perf, lifecycle) only
  // takes effect after a manual restart. Surface that explicitly so users
  // aren't silently stuck on stale behaviour.
  const tmPid = await findTerminalManagerPid()
  if (tmPid !== null) {
    process.stdout.write(
      [
        '',
        `Note: terminal-manager (pid ${tmPid}) is still running the previous version.`,
        'TM-side fixes in this update apply to new TMs only — the running one',
        'keeps its old behaviour until restarted.',
        'Run `aimux restart-terminal-manager` when you can afford to lose your',
        'current PTY projects to upgrade it.',
        '',
      ].join('\n')
    )
  }

  return 0
}
