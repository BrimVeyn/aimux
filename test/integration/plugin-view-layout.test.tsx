import { createTestContext, type UiPluginContext } from '@brimveyn/aimux-plugin'
import { renderPluginNode } from '@brimveyn/aimux-plugin/testing'
import { afterEach, beforeEach, expect, test } from 'bun:test'

import gitlogUi from '../../examples/plugins/gitlog/src/ui'
import { appStore } from '../../src/state/app-store'
import { setActiveDispatch } from '../../src/state/dispatch-ref'
import { createInitialState } from '../../src/state/store'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'
import { clearPluginViews, PluginViewHost } from '../../src/ui/plugin-views'

/**
 * What a plugin view is given, and what it may take.
 *
 * A view used to be rendered as a bare child of the centre column: it was laid
 * out against no height at all, so a `flexGrow` child took the room its
 * siblings needed — every header row on one line — and anything past the
 * bottom was drawn over the status bar. Neither is a plugin's mistake to make,
 * so the host is the one that pins the slot. gitlog is the fixture because it
 * is the example that grows in both directions.
 */

const cleanups: (() => Promise<unknown>)[] = []

// Every test file shares one process, so the store another file left behind is
// the store this one starts from unless it says otherwise.
beforeEach(() => {
  appStore.setState(createInitialState())
})

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup !== undefined) await cleanup()
  }
  clearPluginViews()
  setActiveDispatch(null)
  appStore.setState(createInitialState())
})

/** The screen around a view: a tab bar over it, the status bar under it. */
function Screen(): React.ReactNode {
  return (
    <box flexDirection="column" height={16}>
      <text>TABS</text>
      <PluginViewHost />
      <text>STATUSBAR</text>
    </box>
  )
}

test('a view fills its slot and stops at the status bar', async () => {
  const handle = createTestContext({
    extend: extendUiPluginContext,
    host: 'ui',
    id: 'aimux-examples.gitlog',
  })
  await handle.apply(gitlogUi)
  cleanups.push(() => handle.dispose())
  setActiveDispatch(appStore.getState().dispatch)

  const ctx = handle.ctx as UiPluginContext
  ctx.store.dispatch('loaded', {
    branch: 'trunk',
    commits: Array.from({ length: 40 }, (_, index) => ({
      author: 'Test Author',
      date: '2026-09-09T12:00:00Z',
      sha: String(index).padStart(40, '0'),
      short: String(index).padStart(7, '0'),
      subject: `commit number ${index}`,
    })),
    repoRoot: '/tmp/repo',
  })
  ctx.store.dispatch('detail', {
    sha: '0'.repeat(40),
    text: ' src/app.tsx | 12 ++++--------\n 1 file changed, 4 insertions(+), 8 deletions(-)',
    truncated: false,
  })
  appStore.getState().dispatch({ type: 'open-plugin-view', viewId: 'aimux-examples.gitlog.log' })

  const rendered = await renderPluginNode(<Screen />, {
    cols: 80,
    rows: 16,
    // Both columns: the right one fills in after the store dispatch, and
    // asserting on a frame that has only the left one is a flaky test.
    until: (frame) => frame.includes('commit number 0') && frame.includes('src/app.tsx'),
  })
  const lines = rendered.frame.split('\n')

  // The status bar is still the last line the view has not touched: nothing
  // the plugin drew is on it, and it is still there at all.
  const status = lines.findIndex((line) => line.includes('STATUSBAR'))
  expect(status).toBeGreaterThan(0)
  expect(lines[status]).not.toContain('move')
  expect(lines[status]).not.toContain('commit number')

  // The view's own footer sits above it, on a line of its own.
  const hints = lines.findIndex((line) => line.includes('move'))
  expect(hints).toBeGreaterThan(0)
  expect(hints).toBeLessThan(status)

  // Both panel headings survive a body that wants every line: a heading
  // squeezed by a growing sibling does not get shorter, it disappears.
  expect(lines[1]).toContain('Commits — trunk')
  expect(lines[1]).toContain('Files')

  // And the right column's header rows are rows: the sha, the author and the
  // file line each on their own, not painted on top of each other.
  const sha = lines.findIndex((line) => line.includes('0000000'))
  const author = lines.findIndex((line) => line.includes('Test Author'))
  const file = lines.findIndex((line) => line.includes('src/app.tsx'))
  expect(sha).toBeGreaterThanOrEqual(0)
  expect(author).toBeGreaterThan(sha)
  expect(file).toBeGreaterThan(author)

  rendered.dispose()
})
