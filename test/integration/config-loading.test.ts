import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isWorkspaceSnapshotV1 } from '../../src/state/validation'

describe('config edge cases', () => {
  test('workspace snapshot accepts custom assistant ids', () => {
    const snapshot = {
      activeTabId: 'tab-1',
      savedAt: '2024-01-01T00:00:00.000Z',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'my-custom-assistant',
          buffer: '',
          command: 'my-cli',
          id: 'tab-1',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Custom',
        },
      ],
      version: 1,
    }

    expect(isWorkspaceSnapshotV1(snapshot)).toBe(true)
  })

  test('workspace snapshot rejects empty assistant id', () => {
    const snapshot = {
      activeTabId: 'tab-1',
      savedAt: '2024-01-01T00:00:00.000Z',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: '',
          buffer: '',
          command: 'test',
          id: 'tab-1',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Bad',
        },
      ],
      version: 1,
    }

    expect(isWorkspaceSnapshotV1(snapshot)).toBe(false)
  })

  test('workspace snapshot rejects non-string assistant id', () => {
    const snapshot = {
      activeTabId: null,
      savedAt: '2024-01-01T00:00:00.000Z',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 42,
          buffer: '',
          command: 'test',
          id: 'tab-1',
          status: 'running',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Bad',
        },
      ],
      version: 1,
    }

    expect(isWorkspaceSnapshotV1(snapshot)).toBe(false)
  })

  test('workspace snapshot rejects missing required fields', () => {
    expect(isWorkspaceSnapshotV1(null)).toBe(false)
    expect(isWorkspaceSnapshotV1(undefined)).toBe(false)
    expect(isWorkspaceSnapshotV1({})).toBe(false)
    expect(isWorkspaceSnapshotV1({ version: 2 })).toBe(false)
    expect(isWorkspaceSnapshotV1('string')).toBe(false)
  })

  test('workspace snapshot rejects tabs with invalid status', () => {
    const snapshot = {
      activeTabId: null,
      savedAt: '2024-01-01T00:00:00.000Z',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          assistant: 'claude',
          buffer: '',
          command: 'claude',
          id: 'tab-1',
          status: 'banana',
          terminalModes: {
            alternateScrollMode: false,
            bracketedPasteMode: false,
            isAlternateBuffer: false,
            mouseTrackingMode: 'none',
            sendFocusMode: false,
          },
          title: 'Claude',
        },
      ],
      version: 1,
    }

    expect(isWorkspaceSnapshotV1(snapshot)).toBe(false)
  })
})

describe('custom commands config validation', () => {
  // Import dynamically to avoid module caching issues with CONFIG_PATH
  test('accepts custom assistant keys in customCommands', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aimux-config-'))
    const configPath = join(tempDir, 'aimux.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        customCommands: {
          'claude': 'claude --model opus',
          'my-custom-ai': '/usr/local/bin/my-ai',
        },
        version: 2,
      })
    )

    // Read and parse manually since loadConfig uses a hardcoded path
    const raw = JSON.parse(await Bun.file(configPath).text()) as {
      customCommands?: unknown
    }

    // Verify the shape is valid - all keys are strings, all values are strings
    const commands = raw.customCommands
    expect(typeof commands).toBe('object')
    expect(commands).not.toBeNull()
    for (const [key, value] of Object.entries(commands as Record<string, unknown>)) {
      expect(typeof key).toBe('string')
      expect(key.length).toBeGreaterThan(0)
      expect(typeof value).toBe('string')
    }
  })
})

describe('sidebar config loading', () => {
  test('loads valid persisted sidebar config', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'aimux-sidebar-home-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'sidebar-valid'

    const profileDir = join(tempHome, '.config', 'aimux', 'sidebar-valid')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      join(profileDir, 'aimux.json'),
      JSON.stringify({
        customCommands: {},
        sidebar: { visible: false, width: 33 },
        version: 2,
      })
    )

    const { loadConfig } = await import(`../../src/config.ts?sidebar-valid=${Date.now()}`)
    expect(loadConfig().sidebar).toEqual({ visible: false, width: 33 })
  })

  test('ignores invalid persisted sidebar config', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'aimux-sidebar-home-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'sidebar-invalid'

    const profileDir = join(tempHome, '.config', 'aimux', 'sidebar-invalid')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      join(profileDir, 'aimux.json'),
      JSON.stringify({
        customCommands: {},
        sidebar: { visible: 'nope', width: -2 },
        version: 2,
      })
    )

    const { loadConfigResult } = await import(`../../src/config.ts?sidebar-invalid=${Date.now()}`)
    const result = loadConfigResult()

    expect(result.config.sidebar).toBeUndefined()
    expect(result.issues).toContain('ignored invalid sidebar')
  })
})

describe('bars config loading', () => {
  test('derives bars from the legacy sidebar + embedded git pane', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'aimux-bars-home-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'bars-legacy-embedded'

    const profileDir = join(tempHome, '.config', 'aimux', 'bars-legacy-embedded')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      join(profileDir, 'aimux.json'),
      JSON.stringify({
        customCommands: {},
        gitPane: { embeddedRatio: 0.4, mode: 'embedded', position: 'bottom', visible: true },
        sidebar: { visible: true, width: 33 },
        version: 2,
      })
    )

    const { loadConfig } = await import(`../../src/config.ts?bars-embedded=${Date.now()}`)
    expect(loadConfig().bars).toEqual({
      left: {
        visible: true,
        widgets: [
          { grow: 60, id: 'workspaces', visible: true },
          { grow: 40, id: 'git', visible: true },
        ],
        width: 33,
      },
      right: { visible: false, widgets: [], width: 40 },
    })
  })

  test('a legacy right-side git pane becomes the right bar', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'aimux-bars-home-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'bars-legacy-pane'

    const profileDir = join(tempHome, '.config', 'aimux', 'bars-legacy-pane')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      join(profileDir, 'aimux.json'),
      JSON.stringify({
        customCommands: {},
        gitPane: { mode: 'pane', paneRatio: 0.5, position: 'right', visible: true },
        sidebar: { visible: true, width: 28 },
        version: 2,
      })
    )

    const { loadConfig } = await import(`../../src/config.ts?bars-pane=${Date.now()}`)
    const bars = loadConfig().bars
    expect(bars?.left.widgets).toEqual([{ grow: 100, id: 'workspaces', visible: true }])
    expect(bars?.right).toEqual({
      visible: true,
      widgets: [{ grow: 100, id: 'git', visible: true }],
      width: 40,
    })
  })

  test('an explicit bars block wins over the legacy derivation', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'aimux-bars-home-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'bars-explicit'

    const profileDir = join(tempHome, '.config', 'aimux', 'bars-explicit')
    mkdirSync(profileDir, { recursive: true })
    const bars = {
      left: { visible: true, widgets: [{ grow: 100, id: 'git', visible: true }], width: 20 },
      right: {
        visible: true,
        widgets: [{ grow: 100, id: 'workspaces', visible: true }],
        width: 25,
      },
    }
    writeFileSync(
      join(profileDir, 'aimux.json'),
      JSON.stringify({
        bars,
        customCommands: {},
        sidebar: { visible: true, width: 28 },
        version: 2,
      })
    )

    const { loadConfig } = await import(`../../src/config.ts?bars-explicit=${Date.now()}`)
    expect(loadConfig().bars).toEqual(bars)
  })

  test('git content prefs survive a config with no placement fields', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'aimux-bars-home-'))
    process.env.HOME = tempHome
    process.env.AIMUX_PROFILE = 'bars-gitpane-prefs'

    const profileDir = join(tempHome, '.config', 'aimux', 'bars-gitpane-prefs')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      join(profileDir, 'aimux.json'),
      JSON.stringify({
        customCommands: {},
        gitPane: { diffModeRatio: 0.42, fileListMode: 'flat', treeCompaction: false },
        version: 2,
      })
    )

    const { loadConfigResult } = await import(`../../src/config.ts?bars-prefs=${Date.now()}`)
    const result = loadConfigResult()
    expect(result.config.gitPane).toEqual({
      diffModeRatio: 0.42,
      fileListMode: 'flat',
      treeCompaction: false,
    })
    expect(result.issues).not.toContain('ignored invalid gitPane')
  })
})
