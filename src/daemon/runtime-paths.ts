import { chmodSync, constants, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getProfileName } from '../profile-paths'

export function getRuntimeProfile(): string {
  return getProfileName()
}

function getRuntimeBaseDir(): string {
  if (process.env.XDG_RUNTIME_DIR != null && process.env.XDG_RUNTIME_DIR !== '') {
    return join(process.env.XDG_RUNTIME_DIR, `aimux-${getRuntimeProfile()}`)
  }

  return join(process.env.HOME ?? '.', '.local', 'state', `aimux-${getRuntimeProfile()}`)
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

export function getIpcDaemonSocketPath(): string {
  return getDaemonSocketPath()
}

export function getTerminalManagerSocketPath(): string {
  return join(ensureRuntimeDir(), 'terminal-manager.sock')
}

/**
 * File the daemon writes its current Claude hook server URL into. Stable path
 * per profile, so PTYs spawned by a previous daemon can still resolve the
 * URL of a freshly-restarted daemon by reading this file on every invocation.
 */
export function getClaudeHookUrlFilePath(): string {
  return join(ensureRuntimeDir(), 'claude-hook.url')
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

export function tightenSocketPermissions(socketPath: string): void {
  tightenDaemonSocketPermissions(socketPath)
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

export function getSocketSecurityIssue(socketPath: string): string | null {
  return getDaemonSocketSecurityIssue(socketPath)
}

export function removeDaemonSocketIfExists(): void {
  const socketPath = getDaemonSocketPath()
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }
}

export function removeSocketIfExists(socketPath: string): void {
  if (existsSync(socketPath)) {
    unlinkSync(socketPath)
  }
}

export function removeTerminalManagerSocketIfExists(): void {
  removeSocketIfExists(getTerminalManagerSocketPath())
}
