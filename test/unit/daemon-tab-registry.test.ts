import { describe, expect, test } from 'bun:test'

import type { TerminalLine, TerminalSnapshot } from '../../src/state/types'

import {
  type DaemonTabEntry,
  findWorkerNameConflict,
  mergeTabRegistryEntry,
} from '../../src/daemon/daemon'

function snapshot(tag: string): TerminalSnapshot {
  const line: TerminalLine = { spans: [{ text: tag }] }
  return { baseY: 0, cursorVisible: true, lines: [line], viewportY: 0 }
}

function makeAllocator(start = 1): () => number {
  let seq = start
  return () => seq++
}

describe('mergeTabRegistryEntry', () => {
  test('writes viewport when the tab is new', () => {
    const registry = new Map<string, DaemonTabEntry>()
    const alloc = makeAllocator()
    const vp = snapshot('attach')
    mergeTabRegistryEntry(registry, 'S', 't1', 'claude', 'claude', vp, alloc)
    expect(registry.get('t1')?.viewport).toBe(vp)
    expect(registry.get('t1')?.viewportSeq).toBe(1)
  })

  test('preserves a fresher viewport written via render during attachSession await', () => {
    const registry = new Map<string, DaemonTabEntry>()
    const alloc = makeAllocator()

    // Simulate: render event fired during the `attachSession` await and
    // populated the registry with the live viewport.
    const fresh = snapshot('fresh-from-render')
    registry.set('t1', {
      assistant: 'claude',
      command: 'claude',
      projectId: 'S',
      viewport: fresh,
      viewportSeq: 42,
    })

    // Now the attach handler runs with the attach-time (older) viewport.
    const stale = snapshot('stale-from-attach')
    mergeTabRegistryEntry(registry, 'S', 't1', 'claude', 'claude', stale, alloc)

    const entry = registry.get('t1')
    expect(entry?.viewport).toBe(fresh)
    // Seq must also be preserved so subsequent render events remain ordered
    // relative to the live viewport, not reset behind it.
    expect(entry?.viewportSeq).toBe(42)
  })

  test('updates metadata fields even when viewport is preserved', () => {
    const registry = new Map<string, DaemonTabEntry>()
    registry.set('t1', {
      assistant: 'claude',
      command: 'old-cmd',
      projectId: 'S-old',
      viewport: snapshot('preserved'),
      viewportSeq: 7,
    })
    mergeTabRegistryEntry(
      registry,
      'S-new',
      't1',
      'codex',
      'new-cmd',
      snapshot('ignored'),
      makeAllocator()
    )
    const entry = registry.get('t1')
    expect(entry?.projectId).toBe('S-new')
    expect(entry?.assistant).toBe('codex')
    expect(entry?.command).toBe('new-cmd')
  })

  test('does not regress completed auto-rename metadata from a stale attach', () => {
    const registry = new Map<string, DaemonTabEntry>()
    registry.set('t1', {
      assistant: 'claude',
      autoRenameStatus: 'attempted',
      command: 'claude',
      projectId: 'S',
      title: 'Generated title',
      viewport: undefined,
      viewportSeq: 0,
    })

    const entry = mergeTabRegistryEntry(
      registry,
      'S',
      't1',
      'claude',
      'claude',
      undefined,
      makeAllocator(),
      { autoRenameStatus: 'eligible', title: 'Claude' }
    )

    expect(entry.autoRenameStatus).toBe('attempted')
    expect(entry.title).toBe('Generated title')
  })

  test('no viewport anywhere yields seq=0 placeholder (never bumps the allocator)', () => {
    const registry = new Map<string, DaemonTabEntry>()
    let allocCalls = 0
    const alloc = (): number => {
      allocCalls++
      return 99
    }
    mergeTabRegistryEntry(registry, 'S', 't1', 'claude', 'claude', undefined, alloc)
    expect(registry.get('t1')?.viewport).toBeUndefined()
    expect(registry.get('t1')?.viewportSeq).toBe(0)
    expect(allocCalls).toBe(0)
  })
})

describe('findWorkerNameConflict', () => {
  test('scopes worker names to a project project', () => {
    const registry = new Map<string, DaemonTabEntry>([
      [
        'tab-a',
        {
          assistant: 'claude',
          command: 'claude',
          projectId: 'project-a',
          viewport: undefined,
          viewportSeq: 0,
          workerName: 'api',
        },
      ],
      [
        'tab-b',
        {
          assistant: 'codex',
          command: 'codex',
          projectId: 'project-b',
          viewport: undefined,
          viewportSeq: 0,
          workerName: 'api',
        },
      ],
    ])

    expect(findWorkerNameConflict(registry, 'project-a', 'api')).toBe('tab-a')
    expect(findWorkerNameConflict(registry, 'project-b', 'api')).toBe('tab-b')
    expect(findWorkerNameConflict(registry, 'project-a', 'web')).toBeUndefined()
  })
})
