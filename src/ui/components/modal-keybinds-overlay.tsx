import type { ModeId } from '@brimveyn/aimux-config'

import { describeBindings } from '../../input/keymap/describe-bindings'
import { useKeymap } from '../keymap-context'
import { theme } from '../theme'
import { Surface } from './surface'

const KEYS_COLUMN_WIDTH = 12

interface ModalKeybindsOverlayProps {
  modeId: ModeId
  limit?: number
}

export function ModalKeybindsOverlay({ limit, modeId }: ModalKeybindsOverlayProps) {
  const config = useKeymap()
  const bindings = describeBindings(config, modeId, {
    dedupeByDescription: true,
    withDescriptionOnly: true,
  })

  if (bindings.length === 0) return null
  const entries = typeof limit === 'number' ? bindings.slice(0, limit) : bindings

  return (
    <box position="absolute" bottom={2} right={1}>
      <Surface tone="elevated" paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
        {entries.map((binding) => (
          <box key={`${binding.keys}-${binding.description}`} flexDirection="row">
            <box width={KEYS_COLUMN_WIDTH}>
              <text fg={theme.accentAlt}>{binding.keysDisplay}</text>
            </box>
            <text fg={theme.textMuted}>{binding.description ?? ''}</text>
          </box>
        ))}
      </Surface>
    </box>
  )
}
