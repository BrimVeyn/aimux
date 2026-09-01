import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('config profile paths', () => {
  const originalHome = process.env.HOME
  const originalProfile = process.env.AIMUX_PROFILE
  const originalRuntimeProfile = process.env.AIMUX_RUNTIME_PROFILE
  let tempHome: string | null = null

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
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

    if (tempHome != null && tempHome !== '') {
      rmSync(tempHome, { force: true, recursive: true })
      tempHome = null
    }
  })

  test('stores config and catalogs inside the active profile directory', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'aimux-config-profile-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'dev'
    delete process.env.AIMUX_RUNTIME_PROFILE

    const config = await import(`../../src/config.ts?profile=dev-${Date.now()}`)
    const projects = await import(`../../src/state/project-catalog.ts?profile=dev-${Date.now()}`)

    expect(config.getConfigPath()).toBe(join(tempHome, '.config', 'aimux', 'dev', 'aimux.json'))
    expect(projects.getProjectCatalogPath()).toBe(
      join(tempHome, '.config', 'aimux', 'dev', 'aimux-projects.json')
    )
  })

  test('getConfigPath() reflects a profile change made AFTER import (call-time resolution)', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'aimux-config-late-'))
    process.env.HOME = tempHome
    delete process.env.AIMUX_RUNTIME_PROFILE

    // Import once under one profile, then switch — a module-const path would be
    // frozen to the first profile; getConfigPath() must track the change.
    process.env.AIMUX_PROFILE = 'alpha'
    const config = await import(`../../src/config.ts?late=${Date.now()}`)
    expect(config.getConfigPath()).toBe(join(tempHome, '.config', 'aimux', 'alpha', 'aimux.json'))

    process.env.AIMUX_PROFILE = 'beta'
    expect(config.getConfigPath()).toBe(join(tempHome, '.config', 'aimux', 'beta', 'aimux.json'))
  })

  test('persists skippedUpdateVersion through saveConfig/loadConfig', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'aimux-config-skip-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'skip-update'
    delete process.env.AIMUX_RUNTIME_PROFILE

    const config = await import(`../../src/config.ts?skip=${Date.now()}`)

    const ok = config.saveConfig({
      customCommands: {},
      skippedUpdateVersion: '9.9.9',
      version: 2,
    })
    expect(ok).toBe(true)

    const loaded = config.loadConfig()
    expect(loaded.skippedUpdateVersion).toBe('9.9.9')
  })
})
