import type { ModeId } from '@brimveyn/aimux-config'

import { describeBindings } from '../../../../input/keymap/describe-bindings'
import { useKeymap } from '../../../keymap-context'
import { useTheme } from '../../../theme'

const KEYS_COLUMN_WIDTH = 12

interface ModalKeybindsOverlayProps {
  modeId: ModeId
  limit?: number
}

export function ModalKeybindsOverlay({ limit, modeId }: ModalKeybindsOverlayProps) {
  const t = useTheme()
  const config = useKeymap()
  const bindings = describeBindings(config, modeId, {
    mergeAlternativesByDescription: true,
    withDescriptionOnly: true,
  })

  if (bindings.length === 0) return null
  const entries = typeof limit === 'number' ? bindings.slice(0, limit) : bindings

  return (
    <box position="absolute" bottom={0} right={0}>
      <box
        backgroundColor={t.backgroundElement}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        {entries.map((binding) => (
          <box key={binding.description ?? binding.keys} flexDirection="row">
            <box width={KEYS_COLUMN_WIDTH}>
              <text fg={t.textMuted}>{binding.keysDisplay}</text>
            </box>
            <text fg={t.textMuted}>{binding.description ?? ''}</text>
          </box>
        ))}
      </box>
    </box>
  )
}
