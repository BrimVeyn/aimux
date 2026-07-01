import {
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
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

// --- Hot-reexec sidecars ---
//
// Three small files coordinate the daemon-hot-reexec handoff (see
// docs/developer/hot-reexec.md):
//
//   daemon.pid          // current daemon's pid, written on bind
//   daemon.version      // current daemon's process version (Bun version)
//   daemon.handoff.json // present iff the running daemon was spawned as a
//                       // reexec successor. Consumed (deleted) on read so
//                       // a subsequent fresh boot doesn't trip the path.
//
// The renamed-away socket lives at daemon.old.sock until the predecessor
// daemon exits and the dirent is unlinked.

export function getDaemonPidFilePath(): string {
  return join(ensureRuntimeDir(), 'daemon.pid')
}

export function getDaemonVersionFilePath(): string {
  return join(ensureRuntimeDir(), 'daemon.version')
}

export function getDaemonHandoffFilePath(): string {
  return join(ensureRuntimeDir(), 'daemon.handoff.json')
}

export function getDaemonOldSocketPath(): string {
  return join(ensureRuntimeDir(), 'daemon.old.sock')
}

export interface DaemonHandoffV1 {
  version: 1
  fromPid: number
  fromProcessVersion: string
  /** Epoch ms when the handoff was written. Diagnostic only. */
  writtenAt: number
  /** The renamed-away socket the predecessor is about to release. */
  renamedSocketPath: string
}

export function writeDaemonHandoff(data: DaemonHandoffV1): string {
  const path = getDaemonHandoffFilePath()
  writeFileSync(path, JSON.stringify(data), { mode: 0o600 })
  return path
}

/**
 * Reads the handoff file if present and deletes it in the same call. The
 * file is single-use: a daemon that finds it knows it was spawned to take
 * over from a predecessor.
 */
export function consumeDaemonHandoff(): DaemonHandoffV1 | null {
  const path = getDaemonHandoffFilePath()
  if (!existsSync(path)) {
    return null
  }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  try {
    unlinkSync(path)
  } catch {
    // best-effort — the next fresh boot would re-consume it, which is fine.
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonHandoffV1>
    if (
      parsed.version === 1 &&
      typeof parsed.fromPid === 'number' &&
      typeof parsed.fromProcessVersion === 'string' &&
      typeof parsed.writtenAt === 'number' &&
      typeof parsed.renamedSocketPath === 'string'
    ) {
      return parsed as DaemonHandoffV1
    }
    return null
  } catch {
    return null
  }
}

export function writeDaemonPidFile(pid: number): void {
  writeFileSync(getDaemonPidFilePath(), `${pid}\n`, { mode: 0o600 })
}

export function writeDaemonVersionFile(version: string): void {
  writeFileSync(getDaemonVersionFilePath(), `${version}\n`, { mode: 0o600 })
}

export function readDaemonPidFile(): number | null {
  const path = getDaemonPidFilePath()
  if (!existsSync(path)) return null
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function readDaemonVersionFile(): string | null {
  const path = getDaemonVersionFilePath()
  if (!existsSync(path)) return null
  try {
    const v = readFileSync(path, 'utf8').trim()
    return v.length > 0 ? v : null
  } catch {
    return null
  }
}

export function removeDaemonSidecars(): void {
  for (const path of [
    getDaemonPidFilePath(),
    getDaemonVersionFilePath(),
    getDaemonHandoffFilePath(),
    getDaemonOldSocketPath(),
  ]) {
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/**
 * Reexec-only variant: strip pid/version so no bystander (harness, CLI,
 * anything that prefers the pidfile over `lsof`) reads a dead PID during
 * the swap window. The handoff file is intentionally preserved — the
 * successor consumes it on boot to log that it took over from the
 * predecessor. The renamed socket dirent is handled by the shutdown path
 * (which unlinks it after `server.close()` releases the inode).
 */
export function removeDaemonSidecarsForReexec(): void {
  for (const path of [getDaemonPidFilePath(), getDaemonVersionFilePath()]) {
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch {
        // best-effort cleanup
      }
    }
  }
}
