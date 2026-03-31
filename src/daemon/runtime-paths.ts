import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs'
import { constants } from 'node:fs'
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
  try {
    chmodSync(dir, 0o700)
  } catch {
    // best-effort permission tightening
  }
  return dir
}

export function getDaemonSocketPath(): string {
  return join(ensureRuntimeDir(), 'daemon.sock')
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}

export function tightenDaemonSocketPermissions(socketPath: string): void {
  try {
    chmodSync(socketPath, 0o600)
  } catch {
    // best-effort permission tightening
  }
}

export function getDaemonSocketSecurityIssue(socketPath: string): string | null {
  if (!existsSync(socketPath)) {
    return 'socket missing'
  }

  try {
    const stats = lstatSync(socketPath)
    if (!stats.isSocket()) {
      return 'path is not a socket'
    }

    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
      return 'socket owner does not match current user'
    }

    if ((stats.mode & constants.S_IWGRP) !== 0 || (stats.mode & constants.S_IWOTH) !== 0) {
      return 'socket is writable by group or others'
    }

    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function removeDaemonSocketIfExists(): void {
  const socketPath = getDaemonSocketPath()
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }
}
