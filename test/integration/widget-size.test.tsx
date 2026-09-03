import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import { afterEach, expect, test } from 'bun:test'

import { appStore } from '../../src/state/app-store'
import { clearPluginWidgetIds } from '../../src/state/bars'
import { setActiveDispatch } from '../../src/state/dispatch-ref'
import { createInitialState } from '../../src/state/store'
import { Bar } from '../../src/ui/components/layout/bar'
import { clearBarWidgets, registerBarWidget } from '../../src/ui/widgets/registry'

/**
 * How tall a bar widget actually is.
 *
 * A widget was handed its width and had to guess its height, which is the
 * difference between a sparkline that fills its panel and one that draws six
 * rows into a space with four. The height is opentui's arithmetic — a flex
 * share of the bar — so it is measured after layout rather than recomputed
 * here, and this test is the proof that the number a plugin receives is the
 * real one.
 */

const WIDTH = 100
const HEIGHT = 30

let cleanup: (() => void) | null = null

afterEach(() => {
  cleanup?.()
  cleanup = null
  clearBarWidgets()
  clearPluginWidgetIds()
  setActiveDispatch(null)
  appStore.setState(createInitialState())
})

test('a widget is told the rows it got, not just the columns', async () => {
  const sizes: { cols: number; rows: number }[] = []
  const widths: number[] = []

  const off = registerBarWidget({
    id: 'acme.thing.board',
    label: 'Board',
    render: (contentWidth, size) => {
      widths.push(contentWidth)
      sizes.push(size)
      return null
    },
  })

  appStore.setState({
    ...createInitialState(),
    bars: {
      left: {
        visible: true,
        widgets: [{ grow: 100, id: 'acme.thing.board', visible: true }],
        width: 30,
      },
      right: { visible: false, widgets: [], width: 40 },
    },
    dispatch: appStore.getState().dispatch,
  })
  setActiveDispatch(appStore.getState().dispatch)

  const { renderer, renderOnce } = await createTestRenderer({ height: HEIGHT, width: WIDTH })
  const root = createRoot(renderer)
  root.render(<Bar side="left" />)
  cleanup = () => {
    root.unmount()
    off()
  }

  // Two ticks: the first commit lays out, the measurement lands on the next.
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && (sizes.at(-1)?.rows ?? 0) < 1) {
    await renderOnce()
    await Bun.sleep(20)
  }

  const last = sizes.at(-1)
  expect(last).toBeDefined()
  // The bar is the full height minus its own chrome, so the exact number is
  // opentui's; what matters is that it is real and not the zero a widget used
  // to have to guess around.
  expect(last?.rows).toBeGreaterThan(0)
  expect(last?.rows).toBeLessThanOrEqual(HEIGHT)
  // `cols` is the width that already shipped, passed twice on purpose so a
  // plugin can take either.
  expect(last?.cols).toBe(widths.at(-1) ?? -1)
})
