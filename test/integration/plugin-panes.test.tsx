import { createTestContext, type PluginUiApi } from '@brimveyn/aimux-plugin'
import { afterEach, describe, expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { AppState } from '../../src/state/types'

import { allPaneIds, allTabIds } from '../../src/state/layout-tree'
import { serializeProject } from '../../src/state/project-persistence'
import { reduceTabState } from '../../src/state/reducers/tab-state'
import { createInitialState } from '../../src/state/store'
import { createDefaultTerminalModes } from '../../src/state/terminal-modes'
import { clearPluginPanes, getPluginPane } from '../../src/ui/plugin-panes'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'

/**
 * A pane that is not a terminal, end to end: the plugin registers a renderer,
 * opening one splits the layout, and the layout keeps saying which of its
 * leaves has a PTY behind it.
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

function baseState(): AppState {
  const state = createInitialState()
  return { ...state, activeTabId: 'tab-1', tabs: [tab('tab-1')] }
}

function apply(state: AppState, action: AppAction): AppState {
  return reduceTabState(state, action) ?? state
}

afterEach(() => {
  clearPluginPanes()
})

describe('opening a plugin pane', () => {
  test('splits the active pane and leaves the keyboard where it was', () => {
    const next = apply(baseState(), {
      direction: 'vertical',
      paneId: 'acme.thing.board',
      type: 'open-plugin-pane',
    })

    const tree = Object.values(next.layoutTrees)[0]
    expect(tree?.type).toBe('split')
    expect(tree ? allPaneIds(tree) : []).toEqual(['tab-1', 'acme.thing.board'])
    // The pane cannot hold focus, so opening one must not take it away.
    expect(next.activeTabId).toBe('tab-1')
  })

  test('opening the same pane twice is not two panes', () => {
    const once = apply(baseState(), {
      direction: 'vertical',
      paneId: 'acme.thing.board',
      type: 'open-plugin-pane',
    })
    const twice = apply(once, {
      direction: 'horizontal',
      paneId: 'acme.thing.board',
      type: 'open-plugin-pane',
    })

    expect(twice).toBe(once)
  })

  test('closing it collapses the group, like closing a tab does', () => {
    const opened = apply(baseState(), {
      direction: 'vertical',
      paneId: 'acme.thing.board',
      type: 'open-plugin-pane',
    })
    const closed = apply(opened, { paneId: 'acme.thing.board', type: 'close-plugin-pane' })

    expect(closed.layoutTrees).toEqual({})
    expect(closed.tabGroupMap).toEqual({})
  })

  test('the saved layout has no trace of it', () => {
    const opened = apply(baseState(), {
      direction: 'vertical',
      paneId: 'acme.thing.board',
      type: 'open-plugin-pane',
    })
    const snapshot = serializeProject(opened)

    // A group holding one terminal and one plugin pane is not a split worth
    // writing: the plugin may be gone by the next launch.
    expect(snapshot.layoutTrees).toBeUndefined()
    expect(snapshot.tabGroupMap).toBeUndefined()
  })

  test('a terminal beside a pane is still the only tab in the group', () => {
    const opened = apply(baseState(), {
      direction: 'vertical',
      paneId: 'acme.thing.board',
      type: 'open-plugin-pane',
    })
    const tree = Object.values(opened.layoutTrees)[0]

    expect(tree ? allTabIds(tree) : []).toEqual(['tab-1'])
  })
})

describe('ctx.ui.panes', () => {
  test('registers under the qualified id and comes back off on unload', async () => {
    const harness = createTestContext({
      extend: extendUiPluginContext,
      host: 'ui',
      id: 'acme.thing',
    })
    await harness.apply({
      apply(ctx) {
        ;(ctx as unknown as { ui: PluginUiApi }).ui.panes.register({
          id: 'board',
          render: () => null,
          title: 'Board',
        })
      },
    })

    // The plugin said `board`; the host owns the namespace.
    expect(getPluginPane('acme.thing.board')?.title).toBe('Board')

    await harness.dispose()
    expect(getPluginPane('acme.thing.board')).toBeUndefined()
  })
})
