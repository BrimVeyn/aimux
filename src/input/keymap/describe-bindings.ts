import type { Action, ModeId, ResolvedKeymapConfig } from '@brimveyn/aimux-config'

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
  mergeAlternativesByDescription?: boolean
}

const actionObjectIds = new WeakMap<object, number>()
let nextActionObjectId = 0

function getActionSignature(action: Action): string {
  if (typeof action === 'function') {
    let id = actionObjectIds.get(action)
    if (id === undefined) {
      id = nextActionObjectId
      nextActionObjectId += 1
      actionObjectIds.set(action, id)
    }
    return `fn:${id}`
  }

  return `json:${JSON.stringify(action)}`
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
  const resultIndexByDescription = new Map<string, number>()
  const resultIndexByAction = new Map<string, number>()
  const seenKeysDisplayByIndex = new Map<number, Set<string>>()

  for (const binding of mode.bindings) {
    const keysDisplay = formatNotationForDisplay(binding.keys, leaderChord)

    if (options.mergeAlternativesByDescription) {
      const actionSignature = getActionSignature(binding.result)
      const existingIndex = binding.description
        ? resultIndexByDescription.get(binding.description)
        : resultIndexByAction.get(actionSignature)

      if (existingIndex === undefined) {
        if (options.withDescriptionOnly && !binding.description) continue
        const nextIndex = result.length
        if (binding.description) resultIndexByDescription.set(binding.description, nextIndex)
        resultIndexByAction.set(actionSignature, nextIndex)
        seenKeysDisplayByIndex.set(nextIndex, new Set([keysDisplay]))
        result.push({
          description: binding.description,
          group: binding.group,
          keys: binding.keys,
          keysDisplay,
        })
        continue
      }

      const seenKeysDisplay = seenKeysDisplayByIndex.get(existingIndex)
      if (!seenKeysDisplay || seenKeysDisplay.has(keysDisplay)) continue

      seenKeysDisplay.add(keysDisplay)
      const existing = result[existingIndex]
      if (!existing) continue
      if (!existing.description && binding.description) {
        existing.description = binding.description
        existing.group = binding.group
        resultIndexByDescription.set(binding.description, existingIndex)
      }
      existing.keys = `${existing.keys} / ${binding.keys}`
      existing.keysDisplay = `${existing.keysDisplay} / ${keysDisplay}`
      continue
    }

    if (options.withDescriptionOnly && !binding.description) continue

    if (options.dedupeByDescription && binding.description) {
      if (seenDescriptions.has(binding.description)) continue
      seenDescriptions.add(binding.description)
    }
    result.push({
      description: binding.description,
      group: binding.group,
      keys: binding.keys,
      keysDisplay,
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
