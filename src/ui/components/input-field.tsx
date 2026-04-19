import { useTheme } from '../theme'
import { Surface } from './surface'

interface InputFieldProps {
  active: boolean
  value: string
  cursorPos?: number
  placeholder?: string
}

export function InputField({ active, cursorPos, placeholder, value }: InputFieldProps) {
  const theme = useTheme()
  const fg = active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']
  if (!active) {
    const showPlaceholder = !value && !!placeholder
    return (
      <Surface tone="input" padding={1}>
        <text fg={showPlaceholder ? theme.colors['editorLineNumber.foreground'] : fg}>
          {showPlaceholder ? placeholder : value}
        </text>
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
        <span bg={theme.colors['editor.foreground']} fg={theme.colors['editor.background']}>
          {cursorDisplay}
        </span>
        {trailing}
      </text>
    </Surface>
  )
}
