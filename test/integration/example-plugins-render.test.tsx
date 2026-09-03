import { renderPluginNode } from '@brimveyn/aimux-plugin/testing'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRpcTransport } from '../../src/plugins/types'

import { PluginRuntime } from '../../src/plugins/loader'
import { clearPluginWidgetIds, getKnownWidgetIds } from '../../src/state/bars'
import { clearPluginPanes, PluginPaneContent } from '../../src/ui/plugin-panes'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'
import { useStatusBarSegments } from '../../src/ui/status-bar-segments'
import { clearBarWidgets, getWidgetRenderer } from '../../src/ui/widgets/registry'

/**
 * The four example plugins, drawn.
 *
 * Loading all four crashed aimux at startup — `Row` wrapped whatever arrived in
 * its `ReactNode` label in a `<text>`, and three of the four pass a `<text>` of
 * their own. Nothing caught it because every test we had asked what a plugin
 * *registers*; none asked what it *draws*. The examples are the documentation
 * for the whole API, so they are also the widest thing we can put through the
 * renderer in one go — a registry entry that throws on mount is not a widget
 * that looks wrong, it is a screen that never appears.
 *
 * No daemon: the RPC transport answers nothing, which is exactly the state
 * these tiles are in for the first frame after a boot.
 */

const EXAMPLES = join(new URL('../..', import.meta.url).pathname, 'examples', 'plugins')
const TRANSPORT: PluginRpcTransport = { broadcast: () => {}, call: async () => null }
const NAMES = [
  'ghstreak',
  'journal',
  'lazygit',
  'ntfy',
  'palette',
  'pulse',
  'shifter',
  'sysload',
  'tokens',
] as const

let runtime: PluginRuntime | null = null
const cleanups: (() => void)[] = []

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  clearBarWidgets()
  clearPluginWidgetIds()
  clearPluginPanes()
  while (cleanups.length > 0) cleanups.pop()?.()
})

function useTempProfile(): void {
  const tempHome = mkdtempSync(join(tmpdir(), 'aimux-examples-render-'))
  const previousHome = process.env.HOME
  const previousProfile = process.env.AIMUX_PROFILE
  const previousWatch = process.env.AIMUX_PLUGIN_WATCH
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'examples-render-test'
  process.env.AIMUX_PLUGIN_WATCH = '0'
  cleanups.push(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousProfile === undefined) delete process.env.AIMUX_PROFILE
    else process.env.AIMUX_PROFILE = previousProfile
    if (previousWatch === undefined) delete process.env.AIMUX_PLUGIN_WATCH
    else process.env.AIMUX_PLUGIN_WATCH = previousWatch
    rmSync(tempHome, { force: true, recursive: true })
  })
}

/** The pane pulse registers. Panes only draw once opened, so it is named here. */
const PANE_ID = 'aimux-examples.pulse.stats'

/** Every plugin widget, pane and status-bar tile, side by side in one tree. */
function Everything({ widgetIds }: { widgetIds: readonly string[] }) {
  const segments = useStatusBarSegments()
  return (
    <box flexDirection="column">
      {widgetIds.map((id) => (
        <box key={id} flexDirection="column">
          {getWidgetRenderer(id)?.(28, { cols: 28, rows: 10 }) ?? null}
        </box>
      ))}
      {segments.map((segment) => (
        <box key={segment.id}>{segment.render()}</box>
      ))}
      <PluginPaneContent paneId={PANE_ID} />
    </box>
  )
}

test('every example plugin loads and draws its first frame', async () => {
  useTempProfile()

  const instance = new PluginRuntime({
    builtins: [],
    extendContext: extendUiPluginContext,
    host: 'ui',
    transport: TRANSPORT,
    userPlugins: NAMES.map((name) => ({ path: join(EXAMPLES, name) })),
  })
  runtime = instance
  await instance.start()

  const statuses = instance.statuses()
  expect(statuses.map((status) => status.state).sort()).toEqual(NAMES.map(() => 'active'))

  const widgetIds = getKnownWidgetIds().filter((id) => id.startsWith('aimux-examples.'))
  expect(widgetIds.length).toBeGreaterThan(0)

  const rendered = await renderPluginNode(<Everything widgetIds={widgetIds} />, {
    cols: 34,
    rows: 60,
  })
  // The gearbox tile, which is the one that crashed: a label the plugin
  // coloured itself, next to a value it coloured itself.
  expect(rendered.frame).toContain('⚙')
  // And the pane, which draws the same kind of row and would have crashed the
  // moment the user opened it rather than at boot.
  expect(rendered.frame).toContain('Open tabs')
  // The tokens tile, for a tab the daemon half has not answered about yet.
  expect(rendered.frame).toContain('⌁')
  rendered.dispose()
})
