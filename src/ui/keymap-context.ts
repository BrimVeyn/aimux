import {
  getDefaultKeymapConfig,
  type ModeId,
  type ResolvedKeymapConfig,
} from '@brimveyn/aimux-config'
import { createContext, useContext } from 'react'

import { describeBindings } from '../input/keymap/describe-bindings'

const FALLBACK_CONFIG = getDefaultKeymapConfig()

export const KeymapContext = createContext<ResolvedKeymapConfig>(FALLBACK_CONFIG)

export function useKeymap(): ResolvedKeymapConfig {
  return useContext(KeymapContext)
}

const HELP_JOINER = '  ·  '
const MAX_HELP_ENTRIES = 5

interface BuildHintOptions {
  excludeDescriptions?: readonly string[]
}

/** Build a single-line help string for a mode (used in modal headers and status bar). */
export function buildHintText(
  config: ResolvedKeymapConfig,
  modeId: ModeId,
  limit: number = MAX_HELP_ENTRIES,
  options: BuildHintOptions = {}
): string {
  const bindings = describeBindings(config, modeId, {
    dedupeByDescription: true,
    withDescriptionOnly: true,
  })
  if (bindings.length === 0) return ''
  const excluded = new Set(options.excludeDescriptions ?? [])
  const kept =
    excluded.size > 0 ? bindings.filter((b) => !excluded.has(b.description ?? '')) : bindings
  const trimmed = kept.slice(0, limit)
  return trimmed.map((b) => `${b.keysDisplay} ${b.description ?? ''}`.trim()).join(HELP_JOINER)
}
