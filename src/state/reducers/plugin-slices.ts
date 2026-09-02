import type { AppAction } from '../actions'
import type { AppState } from '../types'

/**
 * Plugin state lives in `state.plugins[pluginId]`, and only the plugin that
 * owns the key may change it. This module is the routing: a plugin registers a
 * reducer for its own id, and `plugin-action` envelopes addressed to that id
 * are handed to it.
 *
 * The core reducer never inspects a slice. It cannot: the shape is the
 * plugin's, and knowing it would make the app depend on plugins rather than
 * the other way round.
 */

/**
 * A slice reducer. Receives its own slice (undefined the first time) and
 * returns the next one. Returning the same reference means "no change", which
 * `reducePluginSlices` uses to leave `AppState` untouched.
 */
export type PluginSliceReducer<Slice = unknown> = (
  slice: Slice | undefined,
  action: { actionId: string; payload?: unknown }
) => Slice

const reducers = new Map<string, PluginSliceReducer>()

/**
 * Registers a plugin's slice reducer. Returns the disposer the plugin's fiber
 * holds, so unloading the plugin takes the reducer with it — otherwise a
 * reloaded plugin would stack a second reducer on the same key.
 */
export function registerPluginSlice<Slice>(
  pluginId: string,
  reducer: PluginSliceReducer<Slice>
): () => void {
  reducers.set(pluginId, reducer as PluginSliceReducer)
  return () => {
    if (reducers.get(pluginId) === (reducer as PluginSliceReducer)) reducers.delete(pluginId)
  }
}

/** Test seam: drops every registration. Never called by the app. */
export function clearPluginSlices(): void {
  reducers.clear()
}

/**
 * Last link in the reducer chain, so a plugin can never intercept a core
 * action by accident: by the time this runs, every built-in reducer has
 * already declined the action.
 */
export function reducePluginSlices(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'plugin-action': {
      const reducer = reducers.get(action.pluginId)
      if (!reducer) return null
      const previous = state.plugins[action.pluginId]
      const next = reducer(previous, { actionId: action.actionId, payload: action.payload })
      // Reference equality is the plugin saying "nothing changed"; propagating
      // a new AppState anyway would re-render the whole tree for nothing.
      if (next === previous) return state
      return { ...state, plugins: { ...state.plugins, [action.pluginId]: next } }
    }
    case 'set-plugin-slice': {
      // `undefined` is the unload case: drop the key rather than leave a
      // tombstone that `Object.keys(state.plugins)` would keep reporting.
      if (action.slice === undefined) {
        if (!(action.pluginId in state.plugins)) return state
        const { [action.pluginId]: _dropped, ...rest } = state.plugins
        return { ...state, plugins: rest }
      }
      if (state.plugins[action.pluginId] === action.slice) return state
      return { ...state, plugins: { ...state.plugins, [action.pluginId]: action.slice } }
    }
    case 'bump-plugin-registry':
      return { ...state, pluginRegistryVersion: state.pluginRegistryVersion + 1 }
    case 'open-plugin-view':
      return { ...state, activePluginView: action.viewId, focusMode: 'plugin-view' }
    case 'close-plugin-view': {
      if (state.activePluginView === null) return state
      // Back to the panes, never to whatever opened the view: a plugin view
      // replaces the pane tree outright, so there is no screen behind it to
      // return to the way a modal has one.
      return { ...state, activePluginView: null, focusMode: 'navigation' }
    }
    default:
      return null
  }
}
