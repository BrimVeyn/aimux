import type { ModeId } from '@brimveyn/aimux-config'

import { describeBindings } from '../../../../input/keymap/describe-bindings'
import { useKeymap } from '../../../keymap-context'
import { usePalette, useTheme } from '../../../theme'
import { Surface } from '../../primitives/surface'

const KEYS_COLUMN_WIDTH = 12

interface ModalKeybindsOverlayProps {
  modeId: ModeId
  limit?: number
}

export function ModalKeybindsOverlay({ limit, modeId }: ModalKeybindsOverlayProps) {
  const t = useTheme()
  const p = usePalette()
  const config = useKeymap()
  const bindings = describeBindings(config, modeId, {
    mergeAlternativesByDescription: true,
    withDescriptionOnly: true,
  })

  if (bindings.length === 0) return null
  const entries = typeof limit === 'number' ? bindings.slice(0, limit) : bindings

  return (
    <box position="absolute" bottom={0} right={0}>
      <Surface tone="elevated" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        {entries.map((binding) => (
          <box key={binding.description ?? binding.keys} flexDirection="row">
            <box width={KEYS_COLUMN_WIDTH}>
              <text fg={p.primary}>{binding.keysDisplay}</text>
            </box>
            <text fg={t['text-weak']}>{binding.description ?? ''}</text>
          </box>
        ))}
      </Surface>
    </box>
  )
}
