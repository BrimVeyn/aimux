import { useAppStore } from '../../state/app-store'
import { theme } from '../theme'

function formatChord(chord: string): string {
  if (chord === 'space') return '␣'
  if (chord === 'return') return '⏎'
  if (chord === 'escape') return 'Esc'
  if (chord === 'tab') return 'Tab'
  if (chord === 'backspace') return '⌫'
  if (chord === 'up') return '↑'
  if (chord === 'down') return '↓'
  if (chord === 'left') return '←'
  if (chord === 'right') return '→'
  return chord
}

function formatSequence(chords: string[]): string {
  return chords.map(formatChord).join(' ')
}

export function PendingChordIndicator() {
  const pendingChords = useAppStore((s) => s.pendingChords)

  if (!pendingChords || pendingChords.length === 0) return null

  const label = formatSequence(pendingChords)

  return (
    <box
      position="absolute"
      bottom={2}
      right={2}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.accent}
      borderColor={theme.borderActive}
    >
      <text fg={theme.background}>{label}…</text>
    </box>
  )
}
