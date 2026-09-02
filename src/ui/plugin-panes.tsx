import type { ModeId } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import { registerHelpModeLabel } from '../input/keymap/help-entries'
import { registerModeDerivation } from '../input/modes/bridge'
import { type PluginModeTransitions, registerPluginMode } from '../input/modes/transitions'
import { useAppStore } from '../state/app-store'
import { useTheme } from './theme'

/**
 * Panes contributed by plugins — a leaf in the layout tree that draws
 * something other than a terminal.
 *
 * A bar widget is a narrow strip and a view takes the whole screen; a pane is
 * the thing in between, and the one the pane tree was already shaped for: a
 * board, a diff, a log browser sitting *beside* an agent rather than instead
 * of it.
 *
 * A pane can hold the keyboard. It does not hold `activeTabId` — that stays a
 * tab id in every reducer and side effect in the app — but
 * `state.activePluginPaneId` names it, and registering a pane installs a mode
 * for it exactly the way a full-screen view does: the mode, its help heading,
 * and the derivation that routes input to it while it is the focused pane.
 *
 * They are registered together because they are inseparable in practice. A
 * pane whose mode is unreachable draws and then ignores every key, which looks
 * like a broken plugin rather than a missing registration.
 */

export interface PluginPaneDefinition {
  /** Qualified id, `<pluginId>.<paneId>`. The kernel namespaces it. */
  id: string
  pluginId: string
  /** Drawn in the pane's border, and used as the mode's help heading. */
  title: string
  /** Where the pane's mode may hand over to. Defaults to navigation only. */
  transitions?: PluginModeTransitions
  render: () => ReactNode
}

/**
 * `plugin.pane.<id>` rather than `plugin.<id>`: a plugin may register a view
 * and a pane under the same unqualified name, and two modes with one id would
 * route the second one's keys to the first.
 */
export function pluginPaneModeId(paneId: string): ModeId {
  return `plugin.pane.${paneId}` as ModeId
}

const panes = new Map<string, PluginPaneDefinition>()
const listeners = new Set<() => void>()

function notify(): void {
  // Snapshot: a listener that unsubscribes on notify must not shift the set.
  for (const listener of new Set(listeners)) listener()
}

/** Subscribe to registry changes. The UI host bumps `pluginRegistryVersion` on this. */
export function onPluginPanesChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function registerPluginPane(pane: PluginPaneDefinition): () => void {
  const modeId = pluginPaneModeId(pane.id)
  panes.set(pane.id, pane)

  const disposers = [
    registerPluginMode(modeId, pane.transitions),
    registerHelpModeLabel(modeId, pane.title),
    registerModeDerivation((state) => (state.activePluginPaneId === pane.id ? modeId : null)),
  ]

  notify()
  return () => {
    if (panes.get(pane.id) === pane) panes.delete(pane.id)
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]?.()
    notify()
  }
}

export function getPluginPane(id: string): PluginPaneDefinition | undefined {
  return panes.get(id)
}

/** Test seam. Never called by the app. */
export function clearPluginPanes(): void {
  panes.clear()
  notify()
}

/**
 * Draws one pane's contents.
 *
 * Subscribes to `pluginRegistryVersion` as well as to the id: the registry is
 * not part of the store, so a hot reload that swaps a pane's `render` has no
 * other way to reach React.
 *
 * A pane whose plugin is not loaded says so instead of rendering nothing. It
 * happens for a frame during a reload, and for as long as it takes to fix a
 * plugin that failed — and an unexplained empty rectangle in the middle of a
 * layout is the worse of the two.
 */
export function PluginPaneContent({ paneId }: { paneId: string }): ReactNode {
  useAppStore((s) => s.pluginRegistryVersion)
  const t = useTheme()
  const pane = getPluginPane(paneId)

  if (!pane) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
        <text fg={t.textMuted}>{paneId}</text>
        <text fg={t.textMuted}>not loaded</text>
      </box>
    )
  }
  return pane.render()
}

/** The title a pane's border shows, falling back to the id while it is missing. */
export function pluginPaneTitle(paneId: string): string {
  return getPluginPane(paneId)?.title ?? paneId
}
