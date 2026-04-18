import { parseKeyNotation } from '../../input/keymap/key-chord'
import { formatChord } from '../../input/keymap/key-format'
import { useAppStore } from '../../state/app-store'
import { useKeymap } from '../keymap-context'
import { useTheme } from '../theme'
import { Surface } from './surface'

export function PendingChordOverlay() {
  const theme = useTheme()
  const pendingChords = useAppStore((s) => s.pendingChords)
  const modalOpen = useAppStore((s) => s.modal.type !== null)
  const config = useKeymap()

  if (!pendingChords || pendingChords.length === 0) return null

  const leaderChord = parseKeyNotation(config.leader)[0]
  const display = pendingChords.map((c) => formatChord(c, leaderChord)).join(' ')

  return (
    <box position="absolute" bottom={modalOpen ? 10 : 2} right={1}>
      <Surface tone="elevated" paddingLeft={1} paddingRight={1}>
        <box flexDirection="row">
          <text fg={theme.colors['descriptionForeground']}>pending: </text>
          <text fg={theme.colors['textLink.foreground']}>{display}</text>
          <text fg={theme.colors['descriptionForeground']}> …</text>
        </box>
      </Surface>
    </box>
  )
}
