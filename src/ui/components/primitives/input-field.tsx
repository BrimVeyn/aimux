import { useTheme } from '../../theme'
import { Surface } from './surface'

interface InputFieldProps {
  active: boolean
  value: string
  cursorPos?: number
  placeholder?: string
  /** Rows the box occupies even when empty, so a long answer looks expected. */
  minLines?: number
}

export function InputField({ active, cursorPos, minLines, placeholder, value }: InputFieldProps) {
  const t = useTheme()
  const fg = active ? t.text : t.textMuted
  // The surface pads one row top and bottom.
  const minHeight = minLines != null ? minLines + 2 : undefined
  if (!active) {
    const showPlaceholder = !value && !!(placeholder != null && placeholder !== '')
    return (
      <Surface tone="input" padding={1} minHeight={minHeight}>
        <text fg={showPlaceholder ? t.textMuted : fg}>{showPlaceholder ? placeholder : value}</text>
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
    <Surface tone="inputActive" padding={1} minHeight={minHeight}>
      <text fg={fg}>
        {before}
        <span bg={t.text} fg={t.background}>
          {cursorDisplay}
        </span>
        {trailing}
      </text>
    </Surface>
  )
}
