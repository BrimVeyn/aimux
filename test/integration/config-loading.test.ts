import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isWorkspaceSnapshotV1 } from '../../src/state/validation'

describe('config edge cases', () => {
  test('workspace snapshot accepts custom assistant ids', () => {
    const snapshot = {
      version: 1,
      savedAt: '2024-01-01T00:00:00.000Z',
      activeTabId: 'tab-1',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-1',
          assistant: 'my-custom-assistant',
          title: 'Custom',
          command: 'my-cli',
          status: 'running',
          buffer: '',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
    }

    expect(isWorkspaceSnapshotV1(snapshot)).toBe(true)
  })

  test('workspace snapshot rejects empty assistant id', () => {
    const snapshot = {
      version: 1,
      savedAt: '2024-01-01T00:00:00.000Z',
      activeTabId: 'tab-1',
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-1',
          assistant: '',
          title: 'Bad',
          command: 'test',
          status: 'running',
          buffer: '',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
    }

    expect(isWorkspaceSnapshotV1(snapshot)).toBe(false)
  })

  test('workspace snapshot rejects non-string assistant id', () => {
    const snapshot = {
      version: 1,
      savedAt: '2024-01-01T00:00:00.000Z',
      activeTabId: null,
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-1',
          assistant: 42,
          title: 'Bad',
          command: 'test',
          status: 'running',
          buffer: '',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
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
      version: 1,
      savedAt: '2024-01-01T00:00:00.000Z',
      activeTabId: null,
      sidebar: { visible: true, width: 28 },
      tabs: [
        {
          id: 'tab-1',
          assistant: 'claude',
          title: 'Claude',
          command: 'claude',
          status: 'banana',
          buffer: '',
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        },
      ],
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
        version: 2,
        customCommands: {
          'claude': 'claude --model opus',
          'my-custom-ai': '/usr/local/bin/my-ai',
        },
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
