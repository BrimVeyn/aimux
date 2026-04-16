import type { ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import { parseKeyNotation } from './key-chord'
import { KeymapModeHandler } from './keymap-mode-handler'
import { KeyTrie } from './trie'

/**
 * Build a KeymapModeHandler for each mode defined in the resolved config.
 */
export function buildKeymapHandlers(config: ResolvedKeymapConfig): KeymapModeHandler[] {
  const leaderChord = parseKeyNotation(config.leader)[0]
  const handlers: KeymapModeHandler[] = []

  for (const [modeId, modeDef] of config.modes) {
    const trie = new KeyTrie()

    for (const binding of modeDef.bindings) {
      const sequence = parseKeyNotation(binding.keys, leaderChord)
      trie.insert(sequence, {
        group: binding.group,
        result: binding.result,
      })
    }

    const handler = new KeymapModeHandler(modeId, trie, {
      passthrough: modeDef.isPassthrough,
      timeoutMs: config.timeout,
    })

    handlers.push(handler)
  }

  return handlers
}
