import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

function getRuntimeBaseDir(): string {
  if (process.env.XDG_RUNTIME_DIR) {
    return join(process.env.XDG_RUNTIME_DIR, 'aimux')
  }

  return join(process.env.HOME ?? '.', '.local', 'state', 'aimux')
}

export function ensureRuntimeDir(): string {
  const dir = getRuntimeBaseDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDaemonSocketPath(): string {
  return join(ensureRuntimeDir(), 'daemon.sock')
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}

export function removeDaemonSocketIfExists(): void {
  const socketPath = getDaemonSocketPath()
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }
}
