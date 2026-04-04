import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { getDaemonSocketPath } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'

const ENTRY_POINT = resolve(import.meta.dir, '..', 'index.tsx')

export async function findDaemonPid(socketPath: string): Promise<number | null> {
  try {
    const proc = Bun.spawn(['lsof', '-t', socketPath], { stderr: 'ignore', stdout: 'pipe' })
    const text = await new Response(proc.stdout).text()
    const pid = parseInt(text.trim(), 10)
    return Number.isFinite(pid) ? pid : null
  } catch (error) {
    logDebug('platform.daemon.findPidError', {
      error: error instanceof Error ? error.message : String(error),
      socketPath,
    })
    return null
  }
}

export async function killDaemon(pid: number): Promise<void> {
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

export async function spawnDetachedDaemon(): Promise<boolean> {
  Bun.spawn([process.execPath, 'run', ENTRY_POINT, 'daemon'], {
    detached: true,
    stderr: 'ignore',
    stdin: 'ignore',
    stdout: 'ignore',
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
