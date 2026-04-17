import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getDaemonSocketPath,
  getDaemonSocketSecurityIssue,
  getRuntimeProfile,
  getTerminalManagerSocketPath,
} from '../../src/daemon/runtime-paths'

describe('daemon runtime paths', () => {
  const originalRuntimeDir = process.env.XDG_RUNTIME_DIR
  const originalProfile = process.env.AIMUX_PROFILE
  const originalRuntimeProfile = process.env.AIMUX_RUNTIME_PROFILE
  let tempRuntimeDir: string | null = null

  afterEach(() => {
    if (originalRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR
    } else {
      process.env.XDG_RUNTIME_DIR = originalRuntimeDir
    }

    if (originalProfile === undefined) {
      delete process.env.AIMUX_PROFILE
    } else {
      process.env.AIMUX_PROFILE = originalProfile
    }

    if (originalRuntimeProfile === undefined) {
      delete process.env.AIMUX_RUNTIME_PROFILE
    } else {
      process.env.AIMUX_RUNTIME_PROFILE = originalRuntimeProfile
    }

    if (tempRuntimeDir) {
      rmSync(tempRuntimeDir, { force: true, recursive: true })
      tempRuntimeDir = null
    }
  })

  test('detects overly permissive daemon sockets', async () => {
    tempRuntimeDir = mkdtempSync(join(tmpdir(), 'aimux-runtime-paths-'))
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir

    const socketPath = getDaemonSocketPath()
    const server = createServer()

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => resolve())
    })

    try {
      chmodSync(socketPath, 0o666)
      expect(getDaemonSocketSecurityIssue(socketPath)).toBe('socket is writable by group or others')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })

  test('uses the default runtime profile and socket names', () => {
    tempRuntimeDir = mkdtempSync(join(tmpdir(), 'aimux-runtime-paths-default-'))
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir
    delete process.env.AIMUX_PROFILE
    delete process.env.AIMUX_RUNTIME_PROFILE

    expect(getRuntimeProfile()).toBe('default')
    expect(getDaemonSocketPath()).toBe(join(tempRuntimeDir, 'aimux-default', 'daemon.sock'))
    expect(getTerminalManagerSocketPath()).toBe(
      join(tempRuntimeDir, 'aimux-default', 'terminal-manager.sock')
    )
  })

  test('isolates non-default runtime profiles into separate runtime directories', () => {
    tempRuntimeDir = mkdtempSync(join(tmpdir(), 'aimux-runtime-paths-profile-'))
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir
    process.env.AIMUX_PROFILE = 'Dev Sandbox'
    delete process.env.AIMUX_RUNTIME_PROFILE

    expect(getRuntimeProfile()).toBe('dev-sandbox')
    expect(getDaemonSocketPath()).toBe(join(tempRuntimeDir, 'aimux-dev-sandbox', 'daemon.sock'))
    expect(getTerminalManagerSocketPath()).toBe(
      join(tempRuntimeDir, 'aimux-dev-sandbox', 'terminal-manager.sock')
    )
  })

  test('falls back to AIMUX_RUNTIME_PROFILE when AIMUX_PROFILE is unset', () => {
    tempRuntimeDir = mkdtempSync(join(tmpdir(), 'aimux-runtime-paths-runtime-profile-'))
    process.env.XDG_RUNTIME_DIR = tempRuntimeDir
    delete process.env.AIMUX_PROFILE
    process.env.AIMUX_RUNTIME_PROFILE = 'qa'

    expect(getRuntimeProfile()).toBe('qa')
    expect(getDaemonSocketPath()).toBe(join(tempRuntimeDir, 'aimux-qa', 'daemon.sock'))
  })
})
