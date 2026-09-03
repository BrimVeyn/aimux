import { hasPluginAction, pluginAction } from '@brimveyn/aimux-config'

import type { KeyResult, ModeContext, ModeId } from '../input/modes/types'

import { parseKeyNotation } from '../input/keymap/key-chord'
import { KeymapModeHandler } from '../input/keymap/keymap-mode-handler'
import { getActiveKeymap } from '../input/keymap/keymap-ref'
import { deriveModeId } from '../input/modes/bridge'
import { getHandler } from '../input/modes/registry'
import { appStore } from '../state/app-store'
import { isWidgetRenderable } from '../state/bars'
import { dispatchGlobal, runSideEffectGlobal } from '../state/dispatch-ref'
import { statusBarSegmentIds } from './status-bar-segments'
import { getWidgetLabel } from './widgets/registry'

/**
 * What the screen is showing, and what a key does, answered outside the screen.
 *
 * An agent that writes a plugin has to be able to check its own work. It can
 * already ask whether the plugin loaded (`plugin show`); it could not ask
 * whether the widget is actually visible, what `<leader>+` resolves to, or run
 * an action without a keyboard — so the loop ended with code it believed in and
 * no way to be wrong. These three answers close that, and they live here rather
 * than in the CLI because only the UI process knows any of it.
 */

export interface UiWidgetReport {
  id: string
  label: string
  visible: boolean
  grow: number
  /** True when something can actually draw it — a plugin that failed cannot. */
  renderable: boolean
  /** `plugin` when a manifest placed it and the user has not moved it since. */
  placedBy?: 'plugin'
}

export interface UiBarReport {
  visible: boolean
  width: number
  widgets: UiWidgetReport[]
}

export interface UiStateReport {
  bars: { left: UiBarReport; right: UiBarReport }
  statusBar: string[]
  /** The mode the keyboard is in right now — what `keymap resolve` defaults to. */
  mode: string
  activeTabId: string | null
  activePluginPaneId: string | null
  focusMode: string
  tabs: { id: string; title: string; status: string; pluginPane?: string }[]
}

function describeBar(bar: {
  visible: boolean
  width: number
  widgets: readonly { id: string; grow: number; visible: boolean; placedBy?: 'plugin' }[]
}): UiBarReport {
  return {
    visible: bar.visible,
    widgets: bar.widgets.map((widget) => ({
      grow: widget.grow,
      id: widget.id,
      label: getWidgetLabel(widget.id),
      ...(widget.placedBy === undefined ? {} : { placedBy: widget.placedBy }),
      renderable: isWidgetRenderable(widget.id),
      visible: widget.visible,
    })),
    width: bar.width,
  }
}

export function describeUiState(): UiStateReport {
  const state = appStore.getState()
  return {
    activePluginPaneId: state.activePluginPaneId,
    activeTabId: state.activeTabId,
    bars: { left: describeBar(state.bars.left), right: describeBar(state.bars.right) },
    focusMode: state.focusMode,
    mode: deriveModeId(state),
    statusBar: statusBarSegmentIds(),
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      status: tab.status,
      title: tab.title,
      ...(tab.pluginPane === undefined ? {} : { pluginPane: tab.pluginPane }),
    })),
  }
}

export interface KeymapResolution {
  mode: string
  keys: string
  bound: boolean
  /** Where the binding came from, once there is one. */
  origin?: 'config' | 'plugin'
  pluginId?: string
  group?: string
  /** True while the sequence is a prefix of longer ones and nothing else. */
  prefix?: boolean
  reason?: string
}

/**
 * What `keys` does in `mode`. Answers "did my binding take, or does the user's
 * config already own that key" — the one question a plugin author cannot ask
 * from the outside, and the reason a refused binding used to look identical to
 * a working one.
 */
export function resolveKeymap(keys: string, mode?: string): KeymapResolution {
  const state = appStore.getState()
  const modeId = (mode ?? deriveModeId(state)) as ModeId
  const leader = getActiveKeymap()?.leader
  const sequence = parseKeyNotation(
    keys,
    leader === undefined ? undefined : parseKeyNotation(leader)[0]
  )
  const base = { keys, mode: modeId }

  if (sequence.length === 0) {
    return { ...base, bound: false, reason: 'unparseable key notation' }
  }
  const handler = getHandler(modeId)
  if (handler === undefined) {
    return { ...base, bound: false, reason: 'no handler for this mode' }
  }
  if (!(handler instanceof KeymapModeHandler)) {
    return { ...base, bound: false, reason: 'this mode has a hand-written handler, not a keymap' }
  }

  const binding = handler.trie.find(sequence)
  if (binding === null) {
    return { ...base, bound: false }
  }
  return {
    ...base,
    bound: true,
    ...(binding.group === undefined ? {} : { group: binding.group }),
    origin: binding.pluginId === undefined ? 'config' : 'plugin',
    ...(binding.pluginId === undefined ? {} : { pluginId: binding.pluginId }),
  }
}

export interface ActionRunReport {
  name: string
  ran: boolean
  actions: number
  effects: number
  reason?: string
}

/**
 * Runs a plugin action by its qualified name, as a key press would.
 *
 * The result goes through the same two channels a keybinding's would — actions
 * to the reducer, effects to the side-effect runner — so `aimux action run` and
 * the key it is bound to cannot drift apart. Which is the point: an agent tests
 * the thing the user will press, not a private entry point.
 */
export function runPluginActionByName(name: string): ActionRunReport {
  if (!hasPluginAction(name)) {
    return {
      actions: 0,
      effects: 0,
      name,
      ran: false,
      reason: 'no plugin has registered that action — check `aimux plugin show <id>`',
    }
  }
  const ctx: ModeContext = { state: appStore.getState() }
  const result = pluginAction(name)(ctx) as KeyResult | null
  if (result === null) {
    return { actions: 0, effects: 0, name, ran: true, reason: 'the action declined to handle it' }
  }
  for (const action of result.actions) dispatchGlobal(action)
  for (const effect of result.effects) runSideEffectGlobal(effect)
  return { actions: result.actions.length, effects: result.effects.length, name, ran: true }
}
