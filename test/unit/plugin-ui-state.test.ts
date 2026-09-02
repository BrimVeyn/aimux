import { createTestContext, type PluginUiApi, type PluginUiState } from '@brimveyn/aimux-plugin'
import { afterEach, describe, expect, test } from 'bun:test'

import type { AppState } from '../../src/state/types'

import { appStore } from '../../src/state/app-store'
import { createInitialState } from '../../src/state/store'
import { createDefaultTerminalModes } from '../../src/state/terminal-modes'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'

/**
 * A UI plugin could register anything and read nothing: its own slice was the
 * whole of what it could see. Every one of the example plugins wanted the same
 * thing first — which tab is the user in — so that is what this exposes, and
 * nothing wider.
 */

function tab(id: string, title: string): AppState['tabs'][number] {
  return {
    activity: 'working',
    assistant: 'claude',
    buffer: '',
    command: 'claude',
    id,
    status: 'running',
    terminalModes: createDefaultTerminalModes(),
    title,
  }
}

function ui(): PluginUiApi {
  const handle = createTestContext({ extend: extendUiPluginContext, host: 'ui', id: 'acme.thing' })
  return (handle.ctx as unknown as { ui: PluginUiApi }).ui
}

const initial = createInitialState()

afterEach(() => {
  appStore.setState({ ...initial, dispatch: appStore.getState().dispatch })
})

describe('ctx.ui.state', () => {
  test('reports the tabs, the active one, and the project', () => {
    appStore.setState({
      activeTabId: 't2',
      currentProjectId: 'p1',
      tabs: [tab('t1', 'one'), tab('t2', 'two')],
    })

    const snapshot = ui().state.get()
    expect(snapshot.tabs.map((entry) => entry.title)).toEqual(['one', 'two'])
    expect(snapshot.activeTabId).toBe('t2')
    // `activeTab` is there because every caller was about to look it up.
    expect(snapshot.activeTab?.title).toBe('two')
    expect(snapshot.projectId).toBe('p1')
  })

  test('the projection is narrow: no viewport, no buffer, no terminal modes', () => {
    appStore.setState({ activeTabId: 't1', tabs: [tab('t1', 'one')] })

    const entry = ui().state.get().tabs[0] as unknown as Record<string, unknown>
    expect(Object.keys(entry).sort()).toEqual(['activity', 'assistant', 'id', 'status', 'title'])
  })

  test('the snapshot keeps its identity until something in it changes', () => {
    appStore.setState({ activeTabId: 't1', tabs: [tab('t1', 'one')] })
    const api = ui().state
    const first = api.get()

    // An unrelated slice changing must not re-render every plugin widget.
    appStore.setState({ pendingChords: ['g'] })
    expect(api.get()).toBe(first)

    appStore.setState({ activeTabId: null })
    expect(api.get()).not.toBe(first)
  })

  test('subscribe fires immediately, then on change, and stops on unload', async () => {
    const seen: (string | null)[] = []
    const handle = createTestContext({
      extend: extendUiPluginContext,
      host: 'ui',
      id: 'acme.thing',
    })
    await handle.apply({
      apply(ctx) {
        ;(ctx as unknown as { ui: PluginUiApi }).ui.state.subscribe((next: PluginUiState) => {
          seen.push(next.activeTabId)
        })
      },
    })

    appStore.setState({ activeTabId: 't9', tabs: [tab('t9', 'nine')] })
    expect(seen).toEqual([null, 't9'])

    await handle.dispose()
    appStore.setState({ activeTabId: null })
    expect(seen).toEqual([null, 't9'])
  })
})
