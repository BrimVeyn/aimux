import { describe, expect, test } from 'bun:test'

import { computeVisibleTabIds } from '../../src/gui/host-visible'
import { createLeaf, type LayoutNode } from '../../src/state/layout-tree'

describe('computeVisibleTabIds', () => {
  test('returns [activeTabId] when there is no tree', () => {
    expect(computeVisibleTabIds({}, {}, 'tab-a')).toEqual(['tab-a'])
  })

  test('returns [] when activeTabId is null and no tree', () => {
    expect(computeVisibleTabIds({}, {}, null)).toEqual([])
  })

  test('returns all leaf ids of the active group tree', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-a'),
      ratio: 0.5,
      second: {
        direction: 'horizontal',
        first: createLeaf('tab-b'),
        ratio: 0.5,
        second: createLeaf('tab-c'),
        type: 'split',
      },
      type: 'split',
    }
    const trees = { 'group-1': tree }
    const map = { 'tab-a': 'group-1', 'tab-b': 'group-1', 'tab-c': 'group-1' }
    expect(computeVisibleTabIds(trees, map, 'tab-a').sort()).toEqual(['tab-a', 'tab-b', 'tab-c'])
  })

  test('falls back to [activeTabId] when the tab has a group but no tree entry', () => {
    expect(computeVisibleTabIds({}, { 'tab-a': 'group-x' }, 'tab-a')).toEqual(['tab-a'])
  })
})
