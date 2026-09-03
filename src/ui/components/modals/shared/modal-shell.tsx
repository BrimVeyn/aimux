import type { ModeId } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import { useTheme } from '../../../theme'
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
      {/* No frame, like everything else — the panel background is what lifts the
          modal off the terminal, and the extra column either side is what makes
          it read as a card rather than a box drawn on the screen. */}
      <box
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        width={width}
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
      {keybindsModeId === undefined ? null : <ModalKeybindsOverlay modeId={keybindsModeId} />}
    </box>
  )
}
