import { existsSync } from 'node:fs'

import { getDaemonSocketPath, removeDaemonSocketIfExists } from './daemon/runtime-paths'

async function findDaemonPid(socketPath: string): Promise<number | null> {
  try {
    const proc = Bun.spawn(['lsof', '-t', socketPath], { stdout: 'pipe', stderr: 'ignore' })
    const text = await new Response(proc.stdout).text()
    const pid = parseInt(text.trim(), 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

async function killDaemon(pid: number): Promise<void> {
  process.kill(pid, 'SIGTERM')

  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await Bun.sleep(50)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

async function spawnDaemon(): Promise<boolean> {
  Bun.spawn([process.execPath, 'run', 'src/index.tsx', 'daemon'], {
    stdout: 'ignore',
    stderr: 'ignore',
    stdin: 'ignore',
    detached: true,
  }).unref()

  const deadline = Date.now() + 2_000
  const socketPath = getDaemonSocketPath()
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) {
      return true
    }
    await Bun.sleep(50)
  }
  return false
}

export async function runRestartDaemon(): Promise<number> {
  const socketPath = getDaemonSocketPath()
  const pid = await findDaemonPid(socketPath)

  if (pid !== null) {
    process.stdout.write(`Stopping daemon (pid ${pid})...\n`)
    await killDaemon(pid)
    process.stdout.write('Daemon stopped.\n')
  } else {
    process.stdout.write('No running daemon found.\n')
  }

  removeDaemonSocketIfExists()

  process.stdout.write('Starting daemon...\n')
  const ok = await spawnDaemon()

  if (ok) {
    process.stdout.write('Daemon started.\n')
    return 0
  }

  process.stderr.write('Failed to start daemon.\n')
  return 1
}
