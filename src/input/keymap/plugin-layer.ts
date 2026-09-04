import { pluginAction } from '@brimveyn/aimux-config'

import type { ModeId } from '../modes/types'

import { logDebug } from '../../debug/input-log'
import { getHandler, registerMode } from '../modes/registry'
import { wireKeymapHandler } from './handler-wiring'
import { type KeyChord, parseKeyNotation } from './key-chord'
import { KeymapModeHandler } from './keymap-mode-handler'
import { getActiveKeymap } from './keymap-ref'
import { KeyTrie, type TrieBinding } from './trie'

/**
 * Bindings a plugin asks for, layered over the keymap the user resolved at
 * startup.
 *
 * The layer inserts into the *live* trie of the mode's existing handler rather
 * than rebuilding anything: identity is what `app.tsx`'s callbacks and the
 * terminal-input fast path hold, and a rebuilt handler would quietly lose
 * both. Removal is symmetric, and only removes the binding this layer put
 * there — a key the user rebound in the meantime is not the layer's to take
 * back.
 *
 * Precedence is the one the whole plugin system already uses: what the user
 * wrote wins. A key `aimux.config.ts` has bound is refused with a reason
 * rather than overwritten, because a plugin silently stealing a keybinding is
 * the kind of bug people spend an evening on.
 */

export interface PluginKeyBinding {
  /** Stable binding id within the plugin. */
  id?: string
  /** Human-readable label used by help and conflict reporting. */
  description?: string
  /** Mode id as the keymap writes it, e.g. `navigation`. */
  mode: string
  /** Key notation, `<leader>` included, e.g. `<leader>+`. */
  keys: string
  /** Qualified plugin action name — `<pluginId>.<verb>`, what `k.plugin()` takes. */
  action: string
}

export type BindingRefusal = 'taken' | 'unparseable'

export interface KeymapLayer {
  applied: PluginKeyBinding[]
  refused: { binding: PluginKeyBinding; reason: BindingRefusal }[]
  dispose: () => void
}

const DEFAULT_TIMEOUT_MS = 1000

/**
 * The handler for `mode`, created and registered if this is a mode nobody has
 * bound yet — a plugin pane's own mode, typically, which exists only because
 * the plugin exists.
 */
function handlerFor(mode: ModeId): KeymapModeHandler | null {
  const existing = getHandler(mode)
  if (existing instanceof KeymapModeHandler) return existing
  // A non-keymap handler owns this mode (the hand-written ones). Layering onto
  // it would mean reaching into a foreign key table; refuse instead.
  if (existing !== undefined) return null

  const handler = new KeymapModeHandler(mode, new KeyTrie(), {
    timeoutMs: getActiveKeymap()?.timeout ?? DEFAULT_TIMEOUT_MS,
  })
  registerMode(handler)
  wireKeymapHandler(handler)
  return handler
}

function leaderChord(): KeyChord | undefined {
  const leader = getActiveKeymap()?.leader
  if (leader === undefined) return undefined
  return parseKeyNotation(leader)[0]
}

export function registerKeymapLayer(
  pluginId: string,
  bindings: readonly PluginKeyBinding[]
): KeymapLayer {
  const leader = leaderChord()
  const applied: PluginKeyBinding[] = []
  const refused: { binding: PluginKeyBinding; reason: BindingRefusal }[] = []
  const inserted: { trie: KeyTrie; sequence: KeyChord[]; binding: TrieBinding }[] = []

  for (const binding of bindings) {
    // `parseKeyNotation` throws on notation it cannot read — a malformed chord,
    // or `<leader>` on a keymap that defines no leader. That is right for a
    // config file the user is editing and wrong here: a manifest is a *request*,
    // and one bad key in it must cost that key, not the plugin. Refused is the
    // outcome this whole loop already knows how to report.
    let sequence: KeyChord[] = []
    try {
      sequence = parseKeyNotation(binding.keys, leader)
    } catch {
      sequence = []
    }
    const handler = sequence.length === 0 ? null : handlerFor(binding.mode as ModeId)
    if (handler === null) {
      refused.push({ binding, reason: 'unparseable' })
      continue
    }
    if (handler.trie.find(sequence) !== null) {
      refused.push({ binding, reason: 'taken' })
      continue
    }

    // The action is resolved on every press, not here: the plugin's UI half
    // registers the verb during its own `apply`, which may be after this.
    const entry: TrieBinding = {
      group: pluginId,
      pluginId,
      result: pluginAction(binding.action),
      ...(binding.id === undefined ? {} : { bindingId: binding.id }),
      ...(binding.description === undefined ? {} : { description: binding.description }),
    }
    handler.trie.insert(sequence, entry)
    inserted.push({ binding: entry, sequence, trie: handler.trie })
    applied.push(binding)
  }

  if (refused.length > 0) {
    logDebug('plugin.keymap.refused', {
      bindings: refused.map((entry) => `${entry.binding.keys} (${entry.reason})`),
      pluginId,
    })
  }

  return {
    applied,
    dispose: () => {
      for (const entry of inserted) {
        // Identity check: if the key now holds something else, someone rebound
        // it after us and it is not ours to remove.
        if (entry.trie.find(entry.sequence) !== entry.binding) continue
        entry.trie.remove(entry.sequence)
      }
      inserted.length = 0
    },
    refused,
  }
}
