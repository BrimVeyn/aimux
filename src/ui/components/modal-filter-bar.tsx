import { theme } from '../theme'

interface ModalFilterBarProps {
  filter: string | null
}

export function ModalFilterBar({ filter }: ModalFilterBarProps) {
  return (
    <box paddingLeft={1} paddingRight={1} paddingTop={1}>
      {filter !== null ? <text fg={theme.text}>/{filter}_</text> : null}
    </box>
  )
}
