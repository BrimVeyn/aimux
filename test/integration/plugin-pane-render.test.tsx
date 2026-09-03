import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import { afterEach, describe, expect, test } from 'bun:test'

import { createLeaf, createPluginLeaf, type LayoutNode } from '../../src/state/layout-tree'
import { SplitLayout } from '../../src/ui/components/layout/split-layout'
import { clearPluginPanes, registerPluginPane } from '../../src/ui/plugin-panes'

/**
 * The pane actually draws. Everything else about plugin panes is state, and
 * state that renders nothing is a feature nobody has.
 */

const WIDTH = 80
const HEIGHT = 24

const NOOP = (): void => {}

const FULL_RECT = { cols: WIDTH, rows: HEIGHT, x: 0, y: 0 }
/** No terminals here: this test is about the pane that is not one. */
const NO_TABS: never[] = []

async function renderTree(
  node: LayoutNode,
  until: string
): Promise<{ frame: string; cleanup: () => void }> {
  const { captureCharFrame, renderer, renderOnce } = await createTestRenderer({
    height: HEIGHT,
    width: WIDTH,
  })
  const root = createRoot(renderer)
  root.render(
    <box width={WIDTH} height={HEIGHT} flexDirection="column">
      <SplitLayout
        node={node}
        tabs={NO_TABS}
        activeTabId={null}
        focusMode="navigation"
        mouseForwardingEnabled={false}
        localScrollbackEnabled={false}
        onTerminalMouseEvent={NOOP}
        onTerminalScrollEvent={NOOP}
        contentOrigin={FULL_RECT}
        bounds={FULL_RECT}
      />
    </box>
  )
  // The test renderer paints asynchronously; one `renderOnce` is a request,
  // not a frame.
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && !captureCharFrame().includes(until)) {
    await renderOnce()
    await Bun.sleep(20)
  }
  return {
    cleanup: () => {
      root.unmount()
      renderer.destroy()
    },
    frame: captureCharFrame(),
  }
}

afterEach(() => {
  clearPluginPanes()
})

describe('a plugin pane on screen', () => {
  test('draws the plugin content beside the terminal', async () => {
    registerPluginPane({
      id: 'acme.thing.board',
      pluginId: 'acme.thing',
      render: () => <text>THREE ITEMS QUEUED</text>,
      title: 'Board',
    })

    const { cleanup, frame } = await renderTree(
      {
        direction: 'vertical',
        first: createLeaf('tab-1'),
        ratio: 0.5,
        second: createPluginLeaf('acme.thing.board'),
        type: 'split',
      },
      'THREE ITEMS QUEUED'
    )

    expect(frame).toContain('THREE ITEMS QUEUED')
    // The border carries the plugin's title, the way a terminal pane's does.
    expect(frame).toContain('Board')
    cleanup()
  })

  test('a pane whose plugin is not loaded says so', async () => {
    const { cleanup, frame } = await renderTree(
      {
        direction: 'vertical',
        first: createLeaf('tab-1'),
        ratio: 0.5,
        second: createPluginLeaf('acme.gone.board'),
        type: 'split',
      },
      'not loaded'
    )

    // An unexplained empty rectangle in the middle of a layout is worse than
    // a line saying which plugin owes it.
    expect(frame).toContain('not loaded')
    expect(frame).toContain('acme.gone.board')
    cleanup()
  })
})
