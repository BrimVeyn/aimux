import { getDaemonSocketPath } from './daemon/runtime-paths'
import { findIpcDaemonPid, findTerminalManagerPid } from './platform/daemon-control'
import { runRestartDaemon } from './restart-daemon'

const REPO = 'BrimVeyn/aimux'

async function getLatestRelease(): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  if (!res.ok) return null
  const data = (await res.json()) as { tag_name: string }
  return data.tag_name
}

async function getCurrentVersion(): Promise<string> {
  const { version } = await import('../package.json')
  return `v${version}`
}

export async function runUpdate(): Promise<number> {
  process.stdout.write('Checking for updates...\n')

  const latest = await getLatestRelease()
  if (latest === null) {
    process.stderr.write('Failed to fetch latest release from GitHub.\n')
    return 1
  }

  const current = await getCurrentVersion()
  if (latest === current) {
    process.stdout.write(`Already up to date (${current}).\n`)
    return 0
  }

  process.stdout.write(`Updating aimux ${current} → ${latest}...\n`)

  const remove = Bun.spawn(['bun', 'remove', '-g', 'aimux'], {
    stderr: 'inherit',
    stdout: 'inherit',
  })
  await remove.exited

  const version = latest.startsWith('v') ? latest.slice(1) : latest
  const install = Bun.spawn(['bun', 'install', '-g', `@brimveyn/aimux@${version}`], {
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
