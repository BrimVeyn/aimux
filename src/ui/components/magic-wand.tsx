import { useTokens } from '../theme'

interface MagicWandProps {
  onClick: () => void
}

export function MagicWand({ onClick }: MagicWandProps) {
  const t = useTokens()
  return (
    <box
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >
      <text fg={t.palette.primary}>🪄</text>
    </box>
  )
}
