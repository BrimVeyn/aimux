import type { ResolvedKeymapConfig } from '@brimveyn/aimux-config'

import { collectHelpEntries } from '../input/keymap/help-entries'

export interface GuiHelpEntry {
  keys: string
  keysDisplay: string
  description: string
  group: string
  modeLabel: string
}

export function computeGuiHelpEntries(keymaps: ResolvedKeymapConfig): GuiHelpEntry[] {
  return collectHelpEntries(keymaps).map((entry) => ({
    description: entry.description ?? '',
    group: entry.group ?? '',
    keys: entry.keys,
    keysDisplay: entry.keysDisplay,
    modeLabel: entry.modeLabel,
  }))
}
