import type { ModeId } from '@brimveyn/aimux-config'

import { describeBindings, groupDescribedBindings } from '../../input/keymap/describe-bindings'
import { useKeymap } from '../keymap-context'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ModalShell } from './modal-shell'

interface ModeSection {
  modeId: ModeId
  title: string
}

const SECTIONS: ModeSection[] = [
  { modeId: 'navigation', title: 'Navigation' },
  { modeId: 'terminal-input', title: 'Terminal input' },
  { modeId: 'git-mode', title: 'Git mode' },
]

const KEYS_COLUMN_WIDTH = 22

export function HelpModal() {
  const config = useKeymap()

  return (
    <ModalShell title="Keybindings" keybindsModeId="modal.help" width={uiTokens.modalWidth.lg}>
      {SECTIONS.map((section) => {
        const bindings = describeBindings(config, section.modeId, {
          dedupeByDescription: true,
          withDescriptionOnly: true,
        })
        if (bindings.length === 0) return null
        const groups = groupDescribedBindings(bindings)
        return (
          <box key={section.modeId} flexDirection="column">
            <text fg={theme.text}>{section.title}</text>
            {groups.map((group, groupIdx) => (
              <box
                key={`${section.modeId}-${group.group ?? 'root'}-${groupIdx}`}
                flexDirection="column"
              >
                {group.group ? <text fg={theme.textMuted}> {group.group}</text> : null}
                {group.bindings.map((binding) => (
                  <box key={`${binding.keys}-${binding.description}`} flexDirection="row">
                    <box width={KEYS_COLUMN_WIDTH}>
                      <text fg={theme.accentAlt}> {binding.keysDisplay}</text>
                    </box>
                    <text fg={theme.textMuted}>{binding.description ?? ''}</text>
                  </box>
                ))}
              </box>
            ))}
          </box>
        )
      })}
    </ModalShell>
  )
}
