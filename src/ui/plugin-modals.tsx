import type { ModeId } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import { registerHelpModeLabel } from '../input/keymap/help-entries'
import { registerModeDerivation } from '../input/modes/bridge'
import { type PluginModeTransitions, registerPluginMode } from '../input/modes/transitions'
import { useAppStore } from '../state/app-store'

/**
 * Modals contributed by plugins. One `plugin-modal` arm in `ModalState`
 * carries all of them, so `root.tsx`'s 22-branch switch keeps its
 * `satisfies never` check and adding a modal stays a registration.
 *
 * Same shape as `plugin-views.tsx`, and for the same reason: a modal is a
 * renderer plus a keyboard mode plus its transitions plus a help heading, and
 * the four only work together.
 */

export interface PluginModalDefinition {
  /** Qualified id, `<pluginId>.<modalId>`. The kernel namespaces it. */
  id: string
  pluginId: string
  title: string
  /** Keyboard mode while the modal is up. Defaults to `plugin.<id>`. */
  modeId?: ModeId
  transitions?: PluginModeTransitions
  /** Receives whatever the plugin passed to `open-plugin-modal`. */
  render: (props: unknown) => ReactNode
}

const modals = new Map<string, PluginModalDefinition>()
const listeners = new Set<() => void>()

function notify(): void {
  const current = [...listeners]
  for (const listener of current) listener()
}

export function onPluginModalsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pluginModalModeId(modal: PluginModalDefinition): ModeId {
  return modal.modeId ?? (`plugin.${modal.id}` as ModeId)
}

/**
 * Registers a modal. Returns one disposer that unwinds every registration,
 * so a reload cannot leave a mode behind that nothing renders.
 */
export function registerPluginModal(modal: PluginModalDefinition): () => void {
  const modeId = pluginModalModeId(modal)
  modals.set(modal.id, modal)

  const disposers = [
    registerPluginMode(modeId, modal.transitions),
    registerHelpModeLabel(modeId, modal.title),
    // A modal claims input wherever it is open, including on top of a screen
    // that never flips `focusMode` — which is exactly what the built-in help
    // and flash-jump overlays do, only hard-coded in `bridge.ts`.
    registerModeDerivation((state) =>
      state.modal.type === 'plugin-modal' && state.modal.modalId === modal.id ? modeId : null
    ),
  ]

  notify()
  return () => {
    if (modals.get(modal.id) === modal) modals.delete(modal.id)
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]?.()
    notify()
  }
}

export function getPluginModal(id: string): PluginModalDefinition | undefined {
  return modals.get(id)
}

export function listPluginModals(): PluginModalDefinition[] {
  return [...modals.values()]
}

/** Test seam. Never called by the app. */
export function clearPluginModals(): void {
  modals.clear()
  notify()
}

/**
 * Renders the open plugin modal. Like `PluginViewHost` it subscribes to
 * `pluginRegistryVersion`, so a hot reload that swaps `render` repaints.
 * An id with no registration renders nothing — the one-frame gap while a
 * plugin reloads is not worth a screen of its own.
 */
export function PluginModalHost({
  modalId,
  props,
}: {
  modalId: string
  props: unknown
}): ReactNode {
  useAppStore((s) => s.pluginRegistryVersion)
  return getPluginModal(modalId)?.render(props) ?? null
}
