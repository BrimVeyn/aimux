import { describe, expect, test } from 'bun:test'

import {
  allPaneIds,
  allTabIds,
  computeJunctionEdges,
  computePaneRects,
  createLeaf,
  createPluginLeaf,
  findLeaf,
  getAdjacentLeaf,
  getBoundaryLeafIds,
  isTabLeaf,
  type LayoutNode,
  pruneLayoutTree,
  removeNode,
  resizeSplit,
  splitNode,
} from '../../src/state/layout-tree'

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message)
  }

  return value
}

describe('createLeaf', () => {
  test('creates a leaf node', () => {
    const leaf = createLeaf('tab-1')
    expect(leaf).toEqual({ tabId: 'tab-1', type: 'leaf' })
  })
})

describe('splitNode', () => {
  test('splits a leaf vertically', () => {
    const tree = createLeaf('tab-1')
    const result = splitNode(tree, 'tab-1', 'vertical', createLeaf('tab-2'))

    expect(result).toEqual({
      direction: 'vertical',
      first: { tabId: 'tab-1', type: 'leaf' },
      ratio: 0.5,
      second: { tabId: 'tab-2', type: 'leaf' },
      type: 'split',
    })
  })

  test('splits a leaf horizontally', () => {
    const tree = createLeaf('tab-1')
    const result = splitNode(tree, 'tab-1', 'horizontal', createLeaf('tab-2'))

    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.direction).toBe('horizontal')
    }
  })

  test('splits a nested leaf', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const result = splitNode(tree, 'tab-2', 'horizontal', createLeaf('tab-3'))

    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.first).toEqual({ tabId: 'tab-1', type: 'leaf' })
      expect(result.second.type).toBe('split')
      if (result.second.type === 'split') {
        expect(result.second.direction).toBe('horizontal')
        expect(result.second.first).toEqual({ tabId: 'tab-2', type: 'leaf' })
        expect(result.second.second).toEqual({ tabId: 'tab-3', type: 'leaf' })
      }
    }
  })

  test('returns same tree if target not found', () => {
    const tree = createLeaf('tab-1')
    const result = splitNode(tree, 'tab-999', 'vertical', createLeaf('tab-2'))
    expect(result).toBe(tree)
  })
})

describe('removeNode', () => {
  test('removes the only leaf', () => {
    const tree = createLeaf('tab-1')
    expect(removeNode(tree, 'tab-1')).toBeNull()
  })

  test('removes first child of a split', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const result = removeNode(tree, 'tab-1')
    expect(result).toEqual({ tabId: 'tab-2', type: 'leaf' })
  })

  test('removes second child of a split', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const result = removeNode(tree, 'tab-2')
    expect(result).toEqual({ tabId: 'tab-1', type: 'leaf' })
  })

  test('removes a deeply nested leaf', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: {
        direction: 'horizontal',
        first: createLeaf('tab-2'),
        ratio: 0.5,
        second: createLeaf('tab-3'),
        type: 'split',
      },
      type: 'split',
    }

    const result = removeNode(tree, 'tab-2')
    expect(result).toEqual({
      direction: 'vertical',
      first: { tabId: 'tab-1', type: 'leaf' },
      ratio: 0.5,
      second: { tabId: 'tab-3', type: 'leaf' },
      type: 'split',
    })
  })

  test('returns same tree if target not found', () => {
    const tree = createLeaf('tab-1')
    expect(removeNode(tree, 'tab-999')).toBe(tree)
  })
})

describe('findLeaf', () => {
  test('finds a leaf in a single node', () => {
    expect(findLeaf(createLeaf('tab-1'), 'tab-1')).toBe(true)
    expect(findLeaf(createLeaf('tab-1'), 'tab-2')).toBe(false)
  })

  test('finds a leaf in a nested tree', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }
    expect(findLeaf(tree, 'tab-1')).toBe(true)
    expect(findLeaf(tree, 'tab-2')).toBe(true)
    expect(findLeaf(tree, 'tab-3')).toBe(false)
  })
})

describe('allLeafIds', () => {
  test('returns single leaf id', () => {
    expect(allPaneIds(createLeaf('tab-1'))).toEqual(['tab-1'])
  })

  test('returns all leaf ids in order', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: {
        direction: 'horizontal',
        first: createLeaf('tab-2'),
        ratio: 0.5,
        second: createLeaf('tab-3'),
        type: 'split',
      },
      type: 'split',
    }

    expect(allPaneIds(tree)).toEqual(['tab-1', 'tab-2', 'tab-3'])
  })
})

describe('resizeSplit', () => {
  test('grows a split containing the target', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const result = resizeSplit(tree, 'tab-1', 1)
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.ratio).toBeCloseTo(0.55)
    }
  })

  test('shrinks a split containing the target', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const result = resizeSplit(tree, 'tab-1', -1)
    if (result.type === 'split') {
      expect(result.ratio).toBeCloseTo(0.45)
    }
  })

  test('clamps ratio at minimum', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.15,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const result = resizeSplit(tree, 'tab-1', -1)
    expect(result).toBe(tree) // no change at min
  })

  test('clamps ratio at maximum', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.85,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const result = resizeSplit(tree, 'tab-1', 1)
    expect(result).toBe(tree) // no change at max
  })

  test('returns same tree for leaf', () => {
    const tree = createLeaf('tab-1')
    expect(resizeSplit(tree, 'tab-1', 1)).toBe(tree)
  })
})

describe('computePaneRects', () => {
  const fullBounds = { cols: 100, rows: 40, x: 0, y: 0 }

  test('single leaf takes full bounds', () => {
    const rects = computePaneRects(createLeaf('tab-1'), fullBounds)
    expect(rects.get('tab-1')).toEqual(fullBounds)
  })

  test('vertical split divides columns', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const rects = computePaneRects(tree, fullBounds)
    const r1 = requireValue(rects.get('tab-1'), 'Missing rect for tab-1')
    const r2 = requireValue(rects.get('tab-2'), 'Missing rect for tab-2')

    expect(r1.x).toBe(0)
    expect(r1.cols).toBe(50)
    expect(r1.rows).toBe(40)

    expect(r2.x).toBe(50)
    expect(r2.cols).toBe(50)
    expect(r2.rows).toBe(40)
  })

  test('horizontal split divides rows', () => {
    const tree: LayoutNode = {
      direction: 'horizontal',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    const rects = computePaneRects(tree, fullBounds)
    const r1 = requireValue(rects.get('tab-1'), 'Missing rect for tab-1')
    const r2 = requireValue(rects.get('tab-2'), 'Missing rect for tab-2')

    expect(r1.y).toBe(0)
    expect(r1.rows).toBe(20)
    expect(r1.cols).toBe(100)

    expect(r2.y).toBe(20)
    expect(r2.rows).toBe(20)
    expect(r2.cols).toBe(100)
  })

  test('nested splits produce correct rects', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: {
        direction: 'horizontal',
        first: createLeaf('tab-2'),
        ratio: 0.5,
        second: createLeaf('tab-3'),
        type: 'split',
      },
      type: 'split',
    }

    const rects = computePaneRects(tree, fullBounds)
    expect(rects.size).toBe(3)

    const r1 = requireValue(rects.get('tab-1'), 'Missing rect for tab-1')
    expect(r1.x).toBe(0)
    expect(r1.cols).toBe(50)

    const r2 = requireValue(rects.get('tab-2'), 'Missing rect for tab-2')
    const r3 = requireValue(rects.get('tab-3'), 'Missing rect for tab-3')
    expect(r2.x).toBe(50)
    expect(r3.x).toBe(50)
    expect(r2.y).toBeLessThan(r3.y)
  })
})

describe('getAdjacentLeaf', () => {
  test('returns null for a single leaf', () => {
    expect(getAdjacentLeaf(createLeaf('tab-1'), 'tab-1', 'right')).toBeNull()
  })

  test('navigates right in a vertical split', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    expect(getAdjacentLeaf(tree, 'tab-1', 'right')).toBe('tab-2')
    expect(getAdjacentLeaf(tree, 'tab-2', 'left')).toBe('tab-1')
  })

  test('returns null when no neighbor in direction', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    expect(getAdjacentLeaf(tree, 'tab-1', 'left')).toBeNull()
    expect(getAdjacentLeaf(tree, 'tab-2', 'right')).toBeNull()
  })

  test('navigates down in a horizontal split', () => {
    const tree: LayoutNode = {
      direction: 'horizontal',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    expect(getAdjacentLeaf(tree, 'tab-1', 'down')).toBe('tab-2')
    expect(getAdjacentLeaf(tree, 'tab-2', 'up')).toBe('tab-1')
  })

  test('navigates across nested splits', () => {
    // Layout: [tab-1 | [tab-2 / tab-3]]
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: {
        direction: 'horizontal',
        first: createLeaf('tab-2'),
        ratio: 0.5,
        second: createLeaf('tab-3'),
        type: 'split',
      },
      type: 'split',
    }

    // From tab-1, going right should reach tab-2 (first leaf of second child)
    expect(getAdjacentLeaf(tree, 'tab-1', 'right')).toBe('tab-2')

    // From tab-2, going left should reach tab-1
    expect(getAdjacentLeaf(tree, 'tab-2', 'left')).toBe('tab-1')

    // From tab-3, going left should reach tab-1
    expect(getAdjacentLeaf(tree, 'tab-3', 'left')).toBe('tab-1')

    // From tab-2, going down should reach tab-3
    expect(getAdjacentLeaf(tree, 'tab-2', 'down')).toBe('tab-3')

    // From tab-3, going up should reach tab-2
    expect(getAdjacentLeaf(tree, 'tab-3', 'up')).toBe('tab-2')
  })

  test('returns null for unknown tab', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }

    expect(getAdjacentLeaf(tree, 'tab-999', 'right')).toBeNull()
  })
})

describe('getBoundaryLeafIds', () => {
  test('leaf returns its own id for every side', () => {
    const leaf = createLeaf('tab-1')
    expect(getBoundaryLeafIds(leaf, 'left')).toEqual(['tab-1'])
    expect(getBoundaryLeafIds(leaf, 'right')).toEqual(['tab-1'])
    expect(getBoundaryLeafIds(leaf, 'top')).toEqual(['tab-1'])
    expect(getBoundaryLeafIds(leaf, 'bottom')).toEqual(['tab-1'])
  })

  test('vertical split: left boundary = leaves on the left subtree only', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('a'),
      ratio: 0.5,
      second: createLeaf('b'),
      type: 'split',
    }
    expect(getBoundaryLeafIds(tree, 'left')).toEqual(['a'])
    expect(getBoundaryLeafIds(tree, 'right')).toEqual(['b'])
  })

  test('vertical split: top/bottom boundaries include both children', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('a'),
      ratio: 0.5,
      second: createLeaf('b'),
      type: 'split',
    }
    expect(getBoundaryLeafIds(tree, 'top').sort()).toEqual(['a', 'b'])
    expect(getBoundaryLeafIds(tree, 'bottom').sort()).toEqual(['a', 'b'])
  })

  test('horizontal split: top boundary = first child leaves only', () => {
    const tree: LayoutNode = {
      direction: 'horizontal',
      first: createLeaf('a'),
      ratio: 0.5,
      second: createLeaf('b'),
      type: 'split',
    }
    expect(getBoundaryLeafIds(tree, 'top')).toEqual(['a'])
    expect(getBoundaryLeafIds(tree, 'bottom')).toEqual(['b'])
    expect(getBoundaryLeafIds(tree, 'left').sort()).toEqual(['a', 'b'])
    expect(getBoundaryLeafIds(tree, 'right').sort()).toEqual(['a', 'b'])
  })

  test('nested split: right boundary picks rightmost leaves only', () => {
    // root: vertical [a | horizontal(b/top, c/bottom)]
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('a'),
      ratio: 0.5,
      second: {
        direction: 'horizontal',
        first: createLeaf('b'),
        ratio: 0.5,
        second: createLeaf('c'),
        type: 'split',
      },
      type: 'split',
    }
    expect(getBoundaryLeafIds(tree, 'left')).toEqual(['a'])
    expect(getBoundaryLeafIds(tree, 'right').sort()).toEqual(['b', 'c'])
    expect(getBoundaryLeafIds(tree, 'top').sort()).toEqual(['a', 'b'])
    expect(getBoundaryLeafIds(tree, 'bottom').sort()).toEqual(['a', 'c'])
  })
})

describe('pruneLayoutTree', () => {
  test('keeps valid leaf', () => {
    const leaf = createLeaf('tab-1')
    expect(pruneLayoutTree(leaf, new Set(['tab-1']))).toBe(leaf)
  })

  test('removes invalid leaf', () => {
    const leaf = createLeaf('tab-1')
    expect(pruneLayoutTree(leaf, new Set(['tab-2']))).toBeNull()
  })

  test('keeps valid split unchanged', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }
    expect(pruneLayoutTree(tree, new Set(['tab-1', 'tab-2']))).toBe(tree)
  })

  test('collapses split when one child is invalid', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }
    expect(pruneLayoutTree(tree, new Set(['tab-1']))).toEqual(createLeaf('tab-1'))
  })

  test('returns null when all tabs are invalid', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-2'),
      type: 'split',
    }
    expect(pruneLayoutTree(tree, new Set(['tab-99']))).toBeNull()
  })

  test('prunes nested split correctly', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: {
        direction: 'horizontal',
        first: createLeaf('tab-1'),
        ratio: 0.3,
        second: createLeaf('tab-2'),
        type: 'split',
      },
      ratio: 0.5,
      second: createLeaf('tab-3'),
      type: 'split',
    }
    // Remove tab-2 → inner split collapses to tab-1
    const result = pruneLayoutTree(tree, new Set(['tab-1', 'tab-3']))
    expect(result).toEqual({
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: createLeaf('tab-3'),
      type: 'split',
    })
  })
})

describe('computeJunctionEdges', () => {
  const bounds = { cols: 100, rows: 40, x: 0, y: 0 }
  const origin = { x: 10, y: 5 }

  test('single leaf has no junction edges', () => {
    const map = computeJunctionEdges(createLeaf('only'), bounds, origin)
    expect(map.get('only')).toEqual({})
  })

  test('vertical split: right edge on first, left edge on second', () => {
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('a'),
      ratio: 0.5,
      second: createLeaf('b'),
      type: 'split',
    }
    const map = computeJunctionEdges(tree, bounds, origin)

    const expected = {
      direction: 'vertical' as const,
      screenStart: 10, // origin.x + bounds.x
      tabId: 'a', // first leaf of node.first (matches handleSeparatorMouseDown today)
      totalSize: 100, // bounds.cols
    }

    expect(map.get('a')).toEqual({ right: expected })
    expect(map.get('b')).toEqual({ left: expected })
  })

  test('horizontal split: bottom edge on first, top edge on second', () => {
    const tree: LayoutNode = {
      direction: 'horizontal',
      first: createLeaf('a'),
      ratio: 0.5,
      second: createLeaf('b'),
      type: 'split',
    }
    const map = computeJunctionEdges(tree, bounds, origin)

    const expected = {
      direction: 'horizontal' as const,
      screenStart: 5,
      tabId: 'a',
      totalSize: 40,
    }

    expect(map.get('a')).toEqual({ bottom: expected })
    expect(map.get('b')).toEqual({ top: expected })
  })

  test('nested split: leaves carry multiple ancestor edges', () => {
    // root: vertical [a | horizontal(b/top, c/bottom)]
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('a'),
      ratio: 0.5,
      second: {
        direction: 'horizontal',
        first: createLeaf('b'),
        ratio: 0.5,
        second: createLeaf('c'),
        type: 'split',
      },
      type: 'split',
    }
    const map = computeJunctionEdges(tree, bounds, origin)

    const rootSplit = {
      direction: 'vertical' as const,
      screenStart: 10,
      tabId: 'a',
      totalSize: 100,
    }
    // After removing the separator gap, the inner horizontal split's bounds
    // start at x = bounds.x + firstCols = 50, with cols = 50, rows = 40.
    const innerSplit = {
      direction: 'horizontal' as const,
      screenStart: 5, // origin.y + innerBounds.y (innerBounds.y = 0)
      tabId: 'b', // first leaf of inner split's first child
      totalSize: 40,
    }

    expect(map.get('a')).toEqual({ right: rootSplit })
    expect(map.get('b')).toEqual({ bottom: innerSplit, left: rootSplit })
    expect(map.get('c')).toEqual({ left: rootSplit, top: innerSplit })
  })
})

/**
 * A pane can hold something other than a terminal. The tree itself stays
 * indifferent to what that is — it is geometry — but two questions it is asked
 * have different answers depending on the leaf: "what is on screen" and "what
 * has a PTY behind it".
 */
describe('plugin panes', () => {
  const mixed: LayoutNode = {
    direction: 'vertical',
    first: createLeaf('tab-1'),
    ratio: 0.5,
    second: createPluginLeaf('acme.thing.board'),
    type: 'split',
  }

  test('a plugin leaf is a leaf everywhere geometry looks', () => {
    expect(allPaneIds(mixed)).toEqual(['tab-1', 'acme.thing.board'])
    // And it takes up space: the terminal beside it is half the width, not all
    // of it. Leaving the pane out of the rects would size that PTY wrong.
    const rects = computePaneRects(mixed, { cols: 100, rows: 40, x: 0, y: 0 })
    expect(rects.get('tab-1')?.cols).toBe(50)
    expect(rects.get('acme.thing.board')?.cols).toBe(50)
  })

  test('and is not a tab anywhere a tab is meant', () => {
    expect(allTabIds(mixed)).toEqual(['tab-1'])
  })

  test('an unmarked leaf is a terminal, which is every layout ever persisted', () => {
    expect(isTabLeaf({ tabId: 'tab-1', type: 'leaf' })).toBe(true)
    expect(isTabLeaf(createPluginLeaf('acme.thing.board'))).toBe(false)
  })

  test('splitting can put one beside a terminal', () => {
    const tree = splitNode(
      createLeaf('tab-1'),
      'tab-1',
      'vertical',
      createPluginLeaf('acme.thing.board')
    )
    expect(tree.type).toBe('split')
    expect(allTabIds(tree)).toEqual(['tab-1'])
  })

  test('focus crosses a plugin pane rather than landing on it', () => {
    // Focus is a tab id everywhere in the app; a pane that is not a tab cannot
    // become the active one.
    const tree: LayoutNode = {
      direction: 'vertical',
      first: createLeaf('tab-1'),
      ratio: 0.5,
      second: {
        direction: 'vertical',
        first: createPluginLeaf('acme.thing.board'),
        ratio: 0.5,
        second: createLeaf('tab-2'),
        type: 'split',
      },
      type: 'split',
    }
    expect(getAdjacentLeaf(tree, 'tab-1', 'right')).toBe('tab-2')
    expect(getAdjacentLeaf(tree, 'tab-2', 'left')).toBe('tab-1')
  })

  test('a direction with only plugin panes in it offers no neighbour', () => {
    expect(getAdjacentLeaf(mixed, 'tab-1', 'right')).toBeNull()
  })

  test('persisting drops them: a plugin pane lives for the session', () => {
    // `pruneLayoutTree` is given the live tab ids, and a plugin pane is not
    // one — so a saved layout is terminals, and a restore never waits on a
    // plugin that may never load.
    expect(pruneLayoutTree(mixed, new Set(['tab-1']))).toEqual(createLeaf('tab-1'))
  })
})
