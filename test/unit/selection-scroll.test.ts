import { describe, expect, mock, test } from 'bun:test'

import {
  applyViewportObservation,
  type RendererSelectionApi,
  resetSelectionShiftState,
  shiftSelectionByScroll,
  type ViewportObservation,
} from '../../src/app-runtime/selection-scroll'

interface TestRenderer extends RendererSelectionApi {
  startCalls: { target: unknown; x: number; y: number }[]
  updateCalls: { target: unknown; x: number; y: number; opts: { finishDragging: boolean } }[]
  clearCalls: number
}

function makeSelection(overrides?: {
  isActive?: boolean
  isDragging?: boolean
  anchor?: { x: number; y: number }
  focus?: { x: number; y: number }
  selectedRenderables?: { selectable?: boolean; isDestroyed?: boolean }[]
  touchedRenderables?: { selectable?: boolean; isDestroyed?: boolean }[]
}) {
  return {
    anchor: overrides?.anchor ?? { x: 3, y: 5 },
    focus: overrides?.focus ?? { x: 12, y: 8 },
    isActive: overrides?.isActive ?? true,
    isDragging: overrides?.isDragging ?? false,
    selectedRenderables: overrides?.selectedRenderables ?? [{ selectable: true }],
    touchedRenderables: overrides?.touchedRenderables ?? [],
  }
}

function makeRenderer(getSelection: () => ReturnType<typeof makeSelection> | null): TestRenderer {
  const startCalls: TestRenderer['startCalls'] = []
  const updateCalls: TestRenderer['updateCalls'] = []
  let clearCalls = 0
  return {
    get clearCalls() {
      return clearCalls
    },
    clearSelection: mock(() => {
      clearCalls += 1
    }),
    getSelection,
    get startCalls() {
      return startCalls
    },
    startSelection: mock((target, x, y) => {
      startCalls.push({ target, x, y })
    }),
    get updateCalls() {
      return updateCalls
    },
    updateSelection: mock((target, x, y, opts) => {
      updateCalls.push({ opts, target, x, y })
    }),
  }
}

describe('shiftSelectionByScroll', () => {
  test('shifts selection anchor and focus by -deltaLines on wheel down', () => {
    const target = { selectable: true }
    const renderer = makeRenderer(() =>
      makeSelection({
        anchor: { x: 3, y: 10 },
        focus: { x: 12, y: 14 },
        selectedRenderables: [target],
      })
    )
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, 3)

    expect(renderer.startCalls).toEqual([{ target, x: 3, y: 7 }])
    expect(renderer.updateCalls).toEqual([{ opts: { finishDragging: true }, target, x: 12, y: 11 }])
  })

  test('shifts selection by +|delta| on wheel up (negative delta)', () => {
    const target = { selectable: true }
    const renderer = makeRenderer(() =>
      makeSelection({
        anchor: { x: 3, y: 10 },
        focus: { x: 12, y: 14 },
        selectedRenderables: [target],
      })
    )
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, -3)

    expect(renderer.startCalls[0]).toMatchObject({ x: 3, y: 13 })
    expect(renderer.updateCalls[0]).toMatchObject({ x: 12, y: 17 })
  })

  test('is a no-op when delta is zero', () => {
    const renderer = makeRenderer(() => makeSelection())
    resetSelectionShiftState(renderer)
    shiftSelectionByScroll(renderer, 0)
    expect(renderer.startCalls).toHaveLength(0)
    expect(renderer.updateCalls).toHaveLength(0)
    expect(renderer.clearCalls).toBe(0)
  })

  test('resets state when selection becomes inactive', () => {
    const renderer = makeRenderer(() => null)
    resetSelectionShiftState(renderer)
    shiftSelectionByScroll(renderer, 5)
    expect(renderer.startCalls).toHaveLength(0)
  })

  test('mid-drag shifts only the anchor and leaves focus to the live pointer', () => {
    const target = { selectable: true }
    const renderer = makeRenderer(() =>
      makeSelection({
        anchor: { x: 4, y: 10 },
        focus: { x: 9, y: 22 },
        isDragging: true,
        selectedRenderables: [target],
      })
    )
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, 3)

    expect(renderer.startCalls.at(-1)).toMatchObject({ target, x: 4, y: 7 })
    expect(renderer.updateCalls.at(-1)).toMatchObject({
      opts: { finishDragging: false },
      target,
      x: 9,
      y: 22,
    })
  })

  test('mid-drag with no usable target is a no-op', () => {
    const renderer = makeRenderer(() =>
      makeSelection({
        isDragging: true,
        selectedRenderables: [{ selectable: false }],
        touchedRenderables: [{ isDestroyed: true, selectable: true }],
      })
    )
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, 5)

    expect(renderer.startCalls).toHaveLength(0)
    expect(renderer.updateCalls).toHaveLength(0)
  })

  test('persists cached target across off-screen scrolls', () => {
    const target = { selectable: true }
    let live: ReturnType<typeof makeSelection> | null = makeSelection({
      anchor: { x: 3, y: 10 },
      focus: { x: 12, y: 14 },
      selectedRenderables: [target],
    })
    const renderer = makeRenderer(() => live)
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, 3)
    expect(renderer.startCalls.at(-1)).toMatchObject({ target, x: 3, y: 7 })
    expect(renderer.updateCalls.at(-1)).toMatchObject({ target, x: 12, y: 11 })

    live = makeSelection({
      anchor: { x: 3, y: 7 },
      focus: { x: 12, y: 11 },
      selectedRenderables: [],
      touchedRenderables: [],
    })

    shiftSelectionByScroll(renderer, 20)
    expect(renderer.startCalls.at(-1)).toMatchObject({ target, x: 3, y: -13 })
    expect(renderer.updateCalls.at(-1)).toMatchObject({ target, x: 12, y: -9 })
    expect(renderer.clearCalls).toBe(0)

    live = makeSelection({
      anchor: { x: 3, y: -13 },
      focus: { x: 12, y: -9 },
      selectedRenderables: [],
      touchedRenderables: [],
    })

    shiftSelectionByScroll(renderer, -20)
    expect(renderer.startCalls.at(-1)).toMatchObject({ target, x: 3, y: 7 })
    expect(renderer.updateCalls.at(-1)).toMatchObject({ target, x: 12, y: 11 })
    expect(renderer.clearCalls).toBe(0)
  })

  test('re-seeds cache when live selection diverges (new selection)', () => {
    const first = { selectable: true }
    const second = { selectable: true }
    let live: ReturnType<typeof makeSelection> = makeSelection({
      anchor: { x: 1, y: 1 },
      focus: { x: 2, y: 2 },
      selectedRenderables: [first],
    })
    const renderer = makeRenderer(() => live)
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, 1)
    expect(renderer.startCalls.at(-1)).toMatchObject({ target: first, x: 1, y: 0 })

    live = makeSelection({
      anchor: { x: 10, y: 20 },
      focus: { x: 11, y: 21 },
      selectedRenderables: [second],
    })
    shiftSelectionByScroll(renderer, 5)
    expect(renderer.startCalls.at(-1)).toMatchObject({ target: second, x: 10, y: 15 })
    expect(renderer.updateCalls.at(-1)).toMatchObject({ target: second, x: 11, y: 16 })
  })

  test('skips destroyed renderables when picking a target', () => {
    const live = { selectable: true }
    const renderer = makeRenderer(() =>
      makeSelection({
        selectedRenderables: [{ isDestroyed: true, selectable: true }, live],
      })
    )
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, 1)

    expect(renderer.startCalls[0]?.target).toBe(live)
  })

  test('drops cached target once destroyed and skips shift', () => {
    const target: { selectable: boolean; isDestroyed?: boolean } = { selectable: true }
    let live: ReturnType<typeof makeSelection> = makeSelection({
      anchor: { x: 1, y: 5 },
      focus: { x: 2, y: 6 },
      selectedRenderables: [target],
    })
    const renderer = makeRenderer(() => live)
    resetSelectionShiftState(renderer)

    shiftSelectionByScroll(renderer, 1)
    expect(renderer.startCalls).toHaveLength(1)

    target.isDestroyed = true
    live = makeSelection({
      anchor: { x: 1, y: 4 },
      focus: { x: 2, y: 5 },
      selectedRenderables: [],
      touchedRenderables: [],
    })

    shiftSelectionByScroll(renderer, 1)
    expect(renderer.startCalls).toHaveLength(1)
  })
})

describe('applyViewportObservation', () => {
  function setupRenderer() {
    const target = { selectable: true }
    let live: ReturnType<typeof makeSelection> | null = makeSelection({
      anchor: { x: 1, y: 10 },
      focus: { x: 2, y: 12 },
      selectedRenderables: [target],
    })
    const renderer = makeRenderer(() => live)
    resetSelectionShiftState(renderer)
    return {
      renderer,
      seedLive(next: ReturnType<typeof makeSelection> | null) {
        live = next
      },
      target,
    }
  }

  test('first observation only stores prior, no shift', () => {
    const { renderer } = setupRenderer()
    const next: ViewportObservation = { tabId: 'tab-1', y: 10 }

    const result = applyViewportObservation(renderer, null, next)

    expect(result).toEqual(next)
    expect(renderer.startCalls).toHaveLength(0)
    expect(renderer.clearCalls).toBe(0)
  })

  test('shifts selection by delta when viewportY changes within same tab', () => {
    const { renderer, target } = setupRenderer()

    const result = applyViewportObservation(
      renderer,
      { tabId: 'tab-1', y: 10 },
      { tabId: 'tab-1', y: 7 }
    )

    expect(result).toEqual({ tabId: 'tab-1', y: 7 })
    expect(renderer.startCalls.at(-1)).toMatchObject({ target, x: 1, y: 13 })
    expect(renderer.updateCalls.at(-1)).toMatchObject({ target, x: 2, y: 15 })
  })

  test('skips shift when viewportY is unchanged', () => {
    const { renderer } = setupRenderer()

    applyViewportObservation(renderer, { tabId: 'tab-1', y: 10 }, { tabId: 'tab-1', y: 10 })

    expect(renderer.startCalls).toHaveLength(0)
    expect(renderer.clearCalls).toBe(0)
  })

  test('clears selection and skips shift on tab switch', () => {
    const { renderer } = setupRenderer()

    const result = applyViewportObservation(
      renderer,
      { tabId: 'tab-1', y: 10 },
      { tabId: 'tab-2', y: 4 }
    )

    expect(result).toEqual({ tabId: 'tab-2', y: 4 })
    expect(renderer.startCalls).toHaveLength(0)
    expect(renderer.clearCalls).toBe(1)
  })

  test('clears selection and returns null when next observation is null', () => {
    const { renderer } = setupRenderer()

    const result = applyViewportObservation(renderer, { tabId: 'tab-1', y: 10 }, null)

    expect(result).toBeNull()
    expect(renderer.startCalls).toHaveLength(0)
    expect(renderer.clearCalls).toBe(1)
  })
})
