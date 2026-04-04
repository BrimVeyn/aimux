import { getDaemonSocketPath } from './daemon/runtime-paths'
import { findDaemonPid } from './platform/daemon-control'
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

  const install = Bun.spawn(['bun', 'install', '-g', `github:${REPO}#${latest}`], {
    stderr: 'inherit',
    stdout: 'inherit',
  })

  const exitCode = await install.exited
  if (exitCode !== 0) {
    process.stderr.write('Update failed.\n')
    return 1
  }

  process.stdout.write(`Updated to ${latest}.\n`)

  const pid = await findDaemonPid(getDaemonSocketPath())
  if (pid !== null) {
    process.stdout.write('Restarting daemon...\n')
    await runRestartDaemon()
  }

  return 0
}
