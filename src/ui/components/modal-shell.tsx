import type { ModeId } from '@brimveyn/aimux-config'

import { type BoxRenderable, type OptimizedBuffer, RGBA } from '@opentui/core'
import { type ReactNode } from 'react'

import { useTheme, useTransparent } from '../theme'
import { ModalKeybindsOverlay } from './modal-keybinds-overlay'

interface ModalShellProps {
  children: ReactNode
  footer?: ReactNode
  listGap?: number
  subtitle?: string
  keybindsModeId?: ModeId
  title: string
  width: number | `${number}%`
}

const TRANSPARENT_RGBA = RGBA.fromValues(0, 0, 0, 0)

// opentui's BoxRenderable only paints a fill when `backgroundColor.a > 0`, so
// a fully transparent modal bg leaks the chrome characters underneath. The
// `renderAfter` hook runs after the box paints itself but before its children
// render, so we manually overwrite every interior cell with a blank space.
//
// Two gotchas we hit by reading the zig source (packages/core/src/zig/buffer.zig):
//  1. `setCellWithAlphaBlending` early-returns via `isFullyTransparent` when
//     both fg and bg alpha are 0 — nothing gets written.
//  2. Its `blendCells` deliberately preserves the destination char when the
//     overlay char is `DEFAULT_SPACE_CHAR` (codepoint 32) so that drawing a
//     space on top of existing text does not erase it.
//
// `setCell` (→ `bufferSetCell` → zig `buffer.set`) bypasses both: it writes
// the cell unconditionally, no alpha check, no blending, no char preservation.
// That overwrites each chrome char with a space while keeping the cell bg
// transparent, so the terminal emulator's own (blurred) window bg still shows
// through. Children (modal content) then render on top as normal.
function fillModalInteriorWithSpaces(this: BoxRenderable, buffer: OptimizedBuffer): void {
  const x0 = this.screenX
  const y0 = this.screenY
  const w = this.width
  const h = this.height
  // Inset by 1 on each side so we don't erase the border that renderSelf just
  // drew. The modal always has a single-cell border.
  const startX = x0 + 1
  const startY = y0 + 1
  const endX = x0 + w - 1
  const endY = y0 + h - 1
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      buffer.setCell(x, y, ' ', TRANSPARENT_RGBA, TRANSPARENT_RGBA)
    }
  }
}

export function ModalShell({
  children,
  footer,
  keybindsModeId,
  listGap = 1,
  subtitle,
  title,
  width,
}: ModalShellProps) {
  const theme = useTheme()
  const transparent = useTransparent()
  const bg = transparent ? 'transparent' : theme.colors['sideBar.background']
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        borderColor={theme.colors['focusBorder']}
        backgroundColor={bg}
        padding={1}
        width={width}
        renderAfter={transparent ? fillModalInteriorWithSpaces : undefined}
      >
        <box width="100%" flexDirection="column" gap={listGap}>
          <box flexDirection="column">
            <text fg={theme.colors['terminal.ansiMagenta']}>{title}</text>
            {subtitle ? <text fg={theme.colors['descriptionForeground']}>{subtitle}</text> : null}
          </box>
          {children}
          {footer ? <box>{footer}</box> : null}
        </box>
      </box>
      {keybindsModeId ? <ModalKeybindsOverlay modeId={keybindsModeId} /> : null}
    </box>
  )
}
