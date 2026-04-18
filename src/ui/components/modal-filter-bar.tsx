import { useTheme } from '../theme'
import { Surface } from './surface'

interface ModalFilterBarProps {
  filter: string | null
}

export function ModalFilterBar({ filter }: ModalFilterBarProps) {
  const theme = useTheme()
  if (filter === null) {
    return null
  }

  return (
    <Surface tone="input" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <text fg={theme.colors['editor.foreground']}>/{filter}_</text>
    </Surface>
  )
}
