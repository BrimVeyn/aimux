import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { expect, test } from 'bun:test'

import type { KeyInput, ModeContext } from '../../src/input/modes/types'
import type { GitFileEntry } from '../../src/state/types'

import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler } from '../../src/input/modes/registry'
import { appReducer, createInitialState } from '../../src/state/store'

registerAllModes(getDefaultKeymapConfig())

function key(
  name: string,
  opts: { ctrl?: boolean; shift?: boolean; sequence?: string } = {}
): KeyInput {
  return {
    ctrl: opts.ctrl ?? false,
    meta: false,
    name,
    sequence: opts.sequence ?? name,
    shift: opts.shift ?? false,
  }
}

function ctx(
  files: GitFileEntry[] = [{ added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' }]
): ModeContext {
  const state = appReducer(createInitialState(), {
    payload: { ahead: 0, behind: 0, branch: 'main', files },
    type: 'git-refresh-success',
  })
  return { state: appReducer(state, { type: 'enter-git-mode' }) }
}

test('git-mode Ctrl+n and Ctrl+p skip to file entries', () => {
  const handler = getHandler('git-mode')
  expect(handler?.handleKey(key('n', { ctrl: true }), ctx())?.actions).toEqual([
    { delta: 1, type: 'git-mode-move-file-selection' },
  ])
  expect(handler?.handleKey(key('p', { ctrl: true }), ctx())?.actions).toEqual([
    { delta: -1, type: 'git-mode-move-file-selection' },
  ])
})

test('git-mode Ctrl+l resizes the file bar wider', () => {
  const handler = getHandler('git-mode')
  const result = handler?.handleKey(key('l', { ctrl: true }), ctx())
  expect(result?.actions).toEqual([{ delta: 0.05, type: 'resize-git-diff-pane' }])
  expect(result?.effects[0]?.type).toBe('persist-git-diff-mode-ratio')
  expect(
    result?.effects[0] && 'ratio' in result.effects[0] ? result.effects[0].ratio : null
  ).toBeCloseTo(0.4)
})

test('git-mode Backspace aliases Ctrl+h for narrowing the file bar', () => {
  const handler = getHandler('git-mode')
  const result = handler?.handleKey(key('backspace'), ctx())
  expect(result?.actions).toEqual([{ delta: -0.05, type: 'resize-git-diff-pane' }])
  expect(result?.effects).toEqual([{ ratio: 0.3, type: 'persist-git-diff-mode-ratio' }])
})

test('git-mode Ctrl+h narrows the file bar', () => {
  const handler = getHandler('git-mode')
  const result = handler?.handleKey(key('h', { ctrl: true }), ctx())
  expect(result?.actions).toEqual([{ delta: -0.05, type: 'resize-git-diff-pane' }])
  expect(result?.effects).toEqual([{ ratio: 0.3, type: 'persist-git-diff-mode-ratio' }])
})
