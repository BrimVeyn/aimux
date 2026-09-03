import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { PluginRecord } from '../../src/plugins/types'
import type { AppState, TabSession } from '../../src/state/types'

import { getPluginPaths } from '../../src/plugins/paths'
import { appStore } from '../../src/state/app-store'
import { setActiveDispatch, setActiveSideEffectRunner } from '../../src/state/dispatch-ref'
import { serializeProject } from '../../src/state/project-persistence'
import { createInitialState } from '../../src/state/store'
import { createDefaultTerminalModes } from '../../src/state/terminal-modes'
import {
  clearCommandPanes,
  findCommandPaneTab,
  getCommandPane,
  openCommandPaneIds,
  reconcileCommandPanes,
  recordCommandPaneExit,
  registerCommandPane,
} from '../../src/ui/plugin-command-panes'

/**
 * A pane that runs a program is a tab aimux owns for the plugin. The three
 * lifecycle facts the plan asks for, each as a test: a reload keeps it, an
 * unlink kills it, an exit leaves a pane that says so.
 */
function tab(id: string, extra: Partial<TabSession> = {}): TabSession {
  return {
    activity: 'idle',
    assistant: 'terminal',
    buffer: '',
    command: 'lazygit',
    id,
    status: 'running',
    terminalModes: createDefaultTerminalModes(),
    title: id,
    ...extra,
  }
}

function record(
  id: string,
  panes?: PluginRecord['manifest']['panes'],
  enabled = true
): PluginRecord {
  return {
    config: {},
    enabled,
    enabledFrom: 'default',
    id,
    manifest: { apiVersion: 1, id, panes, version: '1.0.0' },
    paths: getPluginPaths(id, `/tmp/${id}`),
    root: `/tmp/${id}`,
    source: 'link',
  }
}

let effects: unknown[] = []

beforeEach(() => {
  appStore.setState(createInitialState())
  setActiveDispatch(appStore.getState().dispatch)
  effects = []
  setActiveSideEffectRunner((effect) => {
    effects.push(effect)
  })
})

afterEach(() => {
  clearCommandPanes()
  setActiveDispatch(null)
  setActiveSideEffectRunner(null)
})

function withTabs(tabs: TabSession[]): void {
  appStore.setState((state: AppState) => ({ ...state, activeTabId: tabs[0]?.id ?? null, tabs }))
}

describe('declared command panes', () => {
  test('follow the record: registered while enabled, withdrawn when not', () => {
    const plugin = record('acme.git', [{ command: ['lazygit'], id: 'lazygit', title: 'lazygit' }])
    reconcileCommandPanes([plugin])
    expect(getCommandPane('acme.git.lazygit')?.command).toEqual(['lazygit'])

    reconcileCommandPanes([record('acme.git', plugin.manifest.panes, false)])
    expect(getCommandPane('acme.git.lazygit')).toBeUndefined()
  })
})

describe('a running command pane', () => {
  test('survives a reload of its plugin', () => {
    withTabs([tab('tab-1'), tab('tab-2', { pluginPane: 'acme.git.lazygit' })])
    const plugin = record('acme.git', [{ command: ['lazygit'], id: 'lazygit' }])
    reconcileCommandPanes([plugin])
    // A reload re-registers under the same id; the record is the same.
    reconcileCommandPanes([plugin])
    expect(findCommandPaneTab('acme.git.lazygit')?.id).toBe('tab-2')
    expect(effects).toEqual([])
  })

  test('is closed — program included — when its plugin is gone', () => {
    withTabs([tab('tab-1'), tab('tab-2', { pluginPane: 'acme.git.lazygit' })])
    reconcileCommandPanes([])
    expect(openCommandPaneIds()).toEqual([])
    expect(effects).toEqual([{ tabId: 'tab-2', type: 'close-tab' }])
  })

  test('says so when the program exits, rather than vanishing', () => {
    withTabs([tab('tab-1'), tab('tab-2', { pluginPane: 'acme.git.lazygit', title: 'lazygit' })])
    expect(recordCommandPaneExit('tab-2', 1)).toBe(true)
    const after = appStore.getState().tabs.find((entry) => entry.id === 'tab-2')
    expect(after?.errorMessage).toContain('lazygit exited with code 1')
    // An ordinary tab is not this module's business.
    expect(recordCommandPaneExit('tab-1', 0)).toBe(false)
  })

  test('is never written to the project snapshot', () => {
    withTabs([tab('tab-1'), tab('tab-2', { pluginPane: 'acme.git.lazygit' })])
    const snapshot = serializeProject(appStore.getState())
    expect(snapshot.tabs.map((entry) => entry.id)).toEqual(['tab-1'])
  })

  test('registerCommand hands back a disposer that withdraws it', () => {
    const dispose = registerCommandPane({
      command: ['yazi'],
      id: 'acme.files.yazi',
      pluginId: 'acme.files',
      pluginRoot: '/tmp/acme.files',
      title: 'yazi',
    })
    expect(getCommandPane('acme.files.yazi')).toBeDefined()
    dispose()
    expect(getCommandPane('acme.files.yazi')).toBeUndefined()
  })
})
