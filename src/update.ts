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

  // The terminal-manager is intentionally NOT restarted here, since doing so
  // kills live AI sessions. With the manager-protocol MIN bumped to 4, a v3
  // TM (zombie from a previous install) will refuse the daemon's handshake
  // on the next `aimux` launch — the client's probe surfaces that as a
  // BreakingUpdateScreen, where the user explicitly consents to losing
  // sessions before the TM is restarted. We just remind them.
  const tmPid = await findTerminalManagerPid()
  if (tmPid !== null) {
    process.stdout.write(
      [
        '',
        `Note: terminal-manager (pid ${tmPid}) is still running the previous version.`,
        'This update bumps the manager protocol — on the next `aimux` launch,',
        'you will see a "Breaking update" prompt to restart it (which kills',
        'any live PTY sessions). Confirm when ready.',
        '',
      ].join('\n')
    )
  }

  return 0
}
