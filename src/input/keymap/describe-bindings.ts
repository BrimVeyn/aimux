import type { ModeId, ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import { parseKeyNotation } from './key-chord'
import { formatNotationForDisplay } from './key-format'

export interface DescribedBinding {
  keys: string
  keysDisplay: string
  description?: string
  group?: string
}

export interface DescribedBindingGroup {
  group?: string
  bindings: DescribedBinding[]
}

interface DescribeOptions {
  withDescriptionOnly?: boolean
  dedupeByDescription?: boolean
}

export function describeBindings(
  config: ResolvedKeymapConfig,
  modeId: ModeId,
  options: DescribeOptions = {}
): DescribedBinding[] {
  const mode = config.modes.get(modeId)
  if (!mode) return []

  const leaderChord = parseKeyNotation(config.leader)[0]
  const seenDescriptions = new Set<string>()
  const result: DescribedBinding[] = []

  for (const binding of mode.bindings) {
    if (options.withDescriptionOnly && !binding.description) continue
    if (options.dedupeByDescription && binding.description) {
      if (seenDescriptions.has(binding.description)) continue
      seenDescriptions.add(binding.description)
    }
    result.push({
      description: binding.description,
      group: binding.group,
      keys: binding.keys,
      keysDisplay: formatNotationForDisplay(binding.keys, leaderChord),
    })
  }

  return result
}

export function groupDescribedBindings(bindings: DescribedBinding[]): DescribedBindingGroup[] {
  const groups: DescribedBindingGroup[] = []
  const indexByLabel = new Map<string | undefined, number>()

  for (const binding of bindings) {
    const label = binding.group
    const existing = indexByLabel.get(label)
    if (existing === undefined) {
      indexByLabel.set(label, groups.length)
      groups.push({ bindings: [binding], group: label })
    } else {
      groups[existing]?.bindings.push(binding)
    }
  }

  return groups
}
