import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDaemonSocketPath, getDaemonSocketSecurityIssue } from '../../src/daemon/runtime-paths'

describe('daemon runtime paths', () => {
  const originalRuntimeDir = process.env.XDG_RUNTIME_DIR
  let tempRuntimeDir: string | null = null

  afterEach(() => {
    if (originalRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR
    } else {
      process.env.XDG_RUNTIME_DIR = originalRuntimeDir
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
})
