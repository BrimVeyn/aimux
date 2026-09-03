import type { ModeId } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import { registerHelpModeLabel } from '../input/keymap/help-entries'
import { registerModeDerivation } from '../input/modes/bridge'
import { type PluginModeTransitions, registerPluginMode } from '../input/modes/transitions'
import { useAppStore } from '../state/app-store'

/**
 * Full-screen views contributed by plugins — the pane-tree replacement that
 * git mode, settings and stats already are, opened to plugins.
 *
 * Registering one wires four things at once: the renderer, a keyboard mode,
 * the transition rules that let input reach it, and the help heading its
 * bindings appear under. They are inseparable in practice — a view whose mode
 * is unreachable renders and then ignores every key — so registering them
 * separately would only be four chances to forget one.
 */

export interface PluginViewDefinition {
  /** Qualified id, `<pluginId>.<viewId>`. The kernel namespaces it. */
  id: string
  pluginId: string
  /** Shown in the help overlay and by anything listing views. */
  title: string
  /** Keyboard mode entered while the view is up. Defaults to `plugin.<id>`. */
  modeId?: ModeId
  /** Where the mode may be entered from and handed over to. */
  transitions?: PluginModeTransitions
  render: () => ReactNode
}

const views = new Map<string, PluginViewDefinition>()
const listeners = new Set<() => void>()

function notify(): void {
  // Snapshot: a listener that unsubscribes on notify must not shift the set.
  const current = [...listeners]
  for (const listener of current) listener()
}

/** Subscribe to registry changes. The UI host bumps `pluginRegistryVersion` on this. */
export function onPluginViewsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pluginViewModeId(view: PluginViewDefinition): ModeId {
  return view.modeId ?? (`plugin.${view.id}` as ModeId)
}

/**
 * Registers a view. Returns one disposer that unwinds every registration it
 * made, so a plugin reload cannot leave a mode behind that nothing renders.
 */
export function registerPluginView(view: PluginViewDefinition): () => void {
  const modeId = pluginViewModeId(view)
  views.set(view.id, view)

  const disposers = [
    registerPluginMode(modeId, view.transitions),
    registerHelpModeLabel(modeId, view.title),
    // Claims input while this view is the one on screen. Registered here
    // rather than left to the plugin: forgetting it is not a subtle bug, it is
    // a view that swallows every keystroke.
    registerModeDerivation((state) =>
      state.focusMode === 'plugin-view' && state.activePluginView === view.id ? modeId : null
    ),
  ]

  notify()
  return () => {
    if (views.get(view.id) === view) views.delete(view.id)
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]?.()
    notify()
  }
}

export function getPluginView(id: string | null): PluginViewDefinition | undefined {
  return id === null ? undefined : views.get(id)
}

export function listPluginViews(): PluginViewDefinition[] {
  return [...views.values()]
}

/** Test seam. Never called by the app. */
export function clearPluginViews(): void {
  views.clear()
  notify()
}

/**
 * Renders whichever view is active. Subscribes to `pluginRegistryVersion` as
 * well as to the active id: the registry is not part of the store, so a hot
 * reload that swaps a view's `render` has no other way to reach React.
 *
 * A missing view is not an error state worth a screen of its own — it happens
 * for one frame while a plugin reloads — so it renders nothing and lets the
 * next commit sort it out.
 */
export function PluginViewHost(): ReactNode {
  const activeId = useAppStore((s) => s.activePluginView)
  useAppStore((s) => s.pluginRegistryVersion)
  const view = getPluginView(activeId)
  return view?.render() ?? null
}
