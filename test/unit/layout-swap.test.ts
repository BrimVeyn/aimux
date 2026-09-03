import { describe, expect, test } from 'bun:test'

import type { AppState } from '../../src/state/types'

import { allPaneIds, createLeaf, splitNode, swapLeaves } from '../../src/state/layout-tree'
import { reduceTabState } from '../../src/state/reducers/tab-state'
import { createInitialState } from '../../src/state/store'
import { createDefaultTerminalModes } from '../../src/state/terminal-modes'

/**
 * `swap` is the one layout verb the keyboard did not have. It exchanges ids
 * and nothing else — what each leaf holds travels with it, and focus stays
 * on the same tab, now in the other slot.
 */
function tab(id: string): AppState['tabs'][number] {
  return {
    activity: 'idle',
    assistant: 'claude',
    buffer: '',
    command: 'claude',
    id,
    status: 'running',
    terminalModes: createDefaultTerminalModes(),
    title: id,
  }
}

describe('swapLeaves', () => {
  test('exchanges two leaves and leaves the rest of the tree alone', () => {
    const tree = splitNode(createLeaf('a'), 'a', 'vertical', createLeaf('b'))
    const withC = splitNode(tree, 'b', 'horizontal', { kind: 'plugin', tabId: 'c', type: 'leaf' })
    const swapped = swapLeaves(withC, 'a', 'c')
    expect(allPaneIds(swapped)).toEqual(['c', 'b', 'a'])
    // The plugin pane is still the plugin pane, wherever it went.
    expect(
      swapped.type === 'split' && swapped.first.type === 'leaf' ? swapped.first.kind : null
    ).toBe('plugin')
  })
})

describe('swap-pane', () => {
  test('moves the active tab into its neighbour’s slot and keeps it active', () => {
    const base = createInitialState()
    const state: AppState = { ...base, activeTabId: 'a', tabs: [tab('a'), tab('b')] }
    const split = reduceTabState(state, {
      direction: 'vertical',
      newTab: tab('b'),
      type: 'split-pane',
    })
    expect(split).not.toBeNull()
    if (!split) return
    const focusA = { ...split, activeTabId: 'a' }
    const swapped = reduceTabState(focusA, { direction: 'right', type: 'swap-pane' })
    expect(swapped).not.toBeNull()
    if (!swapped) return
    const tree = Object.values(swapped.layoutTrees)[0]
    expect(tree ? allPaneIds(tree) : []).toEqual(['b', 'a'])
    expect(swapped.activeTabId).toBe('a')
  })

  test('is a no-op with nothing on that side', () => {
    const base = createInitialState()
    const state: AppState = { ...base, activeTabId: 'a', tabs: [tab('a')] }
    expect(reduceTabState(state, { direction: 'left', type: 'swap-pane' })).toBe(state)
  })
})
