import type { ModeId } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import { useTheme, useTransparent } from '../../../theme'
import { fillBorderedBoxInterior } from '../../../transparent-fill'
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

export function ModalShell({
  children,
  footer,
  keybindsModeId,
  listGap = 1,
  subtitle,
  title,
  width,
}: ModalShellProps) {
  const t = useTheme()
  const transparent = useTransparent()
  const bg = transparent ? 'transparent' : t.backgroundPanel
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
        borderColor={t.border}
        backgroundColor={bg}
        padding={1}
        width={width}
        renderAfter={transparent ? fillBorderedBoxInterior : undefined}
      >
        <box width="100%" flexDirection="column" gap={listGap}>
          <box flexDirection="column">
            <text fg={t.text}>{title}</text>
            {subtitle != null && subtitle !== '' ? <text fg={t.textMuted}>{subtitle}</text> : null}
          </box>
          {children}
          {footer != null ? <box>{footer}</box> : null}
        </box>
      </box>
      {keybindsModeId ? <ModalKeybindsOverlay modeId={keybindsModeId} /> : null}
    </box>
  )
}
