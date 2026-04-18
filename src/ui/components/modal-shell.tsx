import type { ModeId } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import { theme } from '../theme'
import { ModalKeybindsOverlay } from './modal-keybinds-overlay'
import { Surface } from './surface'

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
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        backgroundColor={theme.colors['editorWidget.background']}
        opacity={0.7}
      />
      <Surface tone="elevated" padding={1} gap={1} width={width}>
        <box width="100%" flexDirection="column" gap={listGap}>
          <box flexDirection="column">
            <text fg={theme.colors['terminal.ansiMagenta']}>{title}</text>
            {subtitle ? <text fg={theme.colors['descriptionForeground']}>{subtitle}</text> : null}
          </box>
          {children}
          {footer ? <box>{footer}</box> : null}
        </box>
      </Surface>
      {keybindsModeId ? <ModalKeybindsOverlay modeId={keybindsModeId} /> : null}
    </box>
  )
}
