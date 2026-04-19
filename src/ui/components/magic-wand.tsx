import { useTheme } from '../theme'

interface MagicWandProps {
  onClick: () => void
}

export function MagicWand({ onClick }: MagicWandProps) {
  const theme = useTheme()
  return (
    <box onMouseDown={onClick}>
      <text fg={theme.colors['textLink.foreground']}>🪄</text>
    </box>
  )
}
