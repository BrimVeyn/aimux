import { useTokens } from '../../theme'

interface BareInputProps {
  value: string
  cursorPos?: number
  placeholder?: string
}

export function BareInput({ cursorPos, placeholder = '', value }: BareInputProps) {
  const t = useTokens()
  const fg = t.palette.ink
  const bg = t.bg
  const placeholderFg = t.faint

  if (!value) {
    const firstChar = placeholder.charAt(0) || ' '
    const rest = placeholder.slice(1)
    return (
      <text>
        <span bg={fg} fg={bg}>
          {firstChar}
        </span>
        <span fg={placeholderFg}>{rest}</span>
      </text>
    )
  }

  const safePos =
    cursorPos === undefined ? value.length : Math.max(0, Math.min(value.length, cursorPos))
  const before = value.slice(0, safePos)
  const cursorOnEnd = safePos >= value.length
  const cursorChar = cursorOnEnd ? ' ' : value.charAt(safePos)
  const after = cursorOnEnd ? '' : value.slice(safePos + 1)

  return (
    <text fg={fg}>
      {before}
      <span bg={fg} fg={bg}>
        {cursorChar}
      </span>
      {after}
    </text>
  )
}
