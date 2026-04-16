import { theme } from '../theme'
import { Surface } from './surface'

interface InputFieldProps {
  active: boolean
  value: string
  cursorPos?: number
}

export function InputField({ active, cursorPos, value }: InputFieldProps) {
  const fg = active ? theme.text : theme.textMuted
  if (!active) {
    return (
      <Surface tone="input" padding={1}>
        <text fg={fg}>{value}</text>
      </Surface>
    )
  }

  const safePos =
    cursorPos === undefined ? value.length : Math.max(0, Math.min(value.length, cursorPos))
  const before = value.slice(0, safePos)
  const atChar = safePos < value.length ? value.charAt(safePos) : undefined
  const cursorOnLineEnd = atChar === undefined || atChar === '\n'
  const cursorDisplay = cursorOnLineEnd ? ' ' : (atChar as string)
  const trailing = cursorOnLineEnd ? value.slice(safePos) : value.slice(safePos + 1)

  return (
    <Surface tone="inputActive" padding={1}>
      <text fg={fg}>
        {before}
        <span bg={theme.text} fg={theme.background}>
          {cursorDisplay}
        </span>
        {trailing}
      </text>
    </Surface>
  )
}
