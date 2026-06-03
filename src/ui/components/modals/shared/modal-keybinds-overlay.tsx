import type { ModeId } from '@brimveyn/aimux-config'

import { type BoxRenderable, type OptimizedBuffer, RGBA } from '@opentui/core'

import { describeBindings } from '../../../../input/keymap/describe-bindings'
import { useKeymap } from '../../../keymap-context'
import { useTheme, useTransparent } from '../../../theme'

const KEYS_COLUMN_WIDTH = 12

const TRANSPARENT_RGBA = RGBA.fromValues(0, 0, 0, 0)

// Same trick as modal-shell: when our bg is transparent, BoxRenderable skips
// its fill so the chrome chars underneath leak through. setCell bypasses alpha
// blending and char-preservation, so we can wipe every interior cell to
// (' ', TRANSPARENT_RGBA, TRANSPARENT_RGBA). No border on this overlay, so
// fill the full bounds (no 1-cell inset).
function fillBoxInteriorWithSpaces(this: BoxRenderable, buffer: OptimizedBuffer): void {
  const x0 = this.screenX
  const y0 = this.screenY
  const endX = x0 + this.width
  const endY = y0 + this.height
  for (let y = y0; y < endY; y++) {
    for (let x = x0; x < endX; x++) {
      buffer.setCell(x, y, ' ', TRANSPARENT_RGBA, TRANSPARENT_RGBA)
    }
  }
}

interface ModalKeybindsOverlayProps {
  modeId: ModeId
  limit?: number
}

export function ModalKeybindsOverlay({ limit, modeId }: ModalKeybindsOverlayProps) {
  const t = useTheme()
  const transparent = useTransparent()
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
        renderAfter={transparent ? fillBoxInteriorWithSpaces : undefined}
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
