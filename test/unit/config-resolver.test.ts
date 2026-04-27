import { describe, expect, test } from 'bun:test'

import { resolveConfig } from '../../packages/aimux-config/src/resolver'

describe('resolveConfig startup override aliases', () => {
  test('normalizes deprecated theme and session bar fields', () => {
    const config = resolveConfig({
      sessionBar: {
        position: 'bottom',
        visible: false,
      },
      theme: {
        mode: 'light',
      },
    })

    expect(config.theme).toEqual({ initialId: undefined, initialMode: 'light' })
    expect(config.sessionBar).toEqual({
      initialPosition: 'bottom',
      initialVisible: false,
    })
  })

  test('prefers initial* fields over deprecated aliases', () => {
    const config = resolveConfig({
      gitPane: {
        diffModeRatio: 0.6,
        fileListMode: 'flat',
        initialDiffModeRatio: 0.3,
        initialFileListMode: 'tree',
        initialMode: 'pane',
        initialPosition: 'right',
        initialRatio: 0.4,
        initialTreeCompaction: true,
        initialVisible: false,
        mode: 'pane',
        position: 'left',
        ratio: 0.7,
        treeCompaction: false,
        visible: true,
      },
      sessionBar: {
        initialPosition: 'top',
        initialVisible: true,
        position: 'bottom',
        visible: false,
      },
      theme: {
        initialMode: 'dark',
        mode: 'light',
      },
    })

    expect(config.theme?.initialMode).toBe('dark')
    expect(config.sessionBar).toEqual({
      initialPosition: 'top',
      initialVisible: true,
    })
    expect(config.gitPane).toEqual({
      diffCount: undefined,
      initialDiffModeRatio: 0.3,
      initialFileListMode: 'tree',
      initialMode: 'pane',
      initialPosition: 'right',
      initialRatio: 0.4,
      initialTreeCompaction: true,
      initialVisible: false,
      path: undefined,
      prefetchRadius: undefined,
    })
  })

  test('keeps gitPane authority fields untouched and does not force a mode', () => {
    const config = resolveConfig({
      gitPane: {
        diffCount: { enabled: false },
        path: { enabled: true, pathFn: (path) => path.replace(/^src\//, '') },
        prefetchRadius: 3,
      },
    })

    expect(config.gitPane).toMatchObject({
      diffCount: { enabled: false },
      path: { enabled: true, pathFn: expect.any(Function) },
      prefetchRadius: 3,
    })
    expect('initialMode' in config.gitPane && config.gitPane.initialMode !== undefined).toBe(false)
  })
})
