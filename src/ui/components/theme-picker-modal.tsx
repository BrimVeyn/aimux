import { useModalHelp } from '../keymap-context'
import { theme } from '../theme'
import { THEME_IDS, type ThemeId, THEMES } from '../themes'
import { uiTokens } from '../ui-tokens'
import { ListItem } from './list-item'
import { ModalShell } from './modal-shell'

interface ThemePickerModalProps {
  selectedIndex: number
  currentThemeId: ThemeId
}

export function ThemePickerModal({ currentThemeId, selectedIndex }: ThemePickerModalProps) {
  const help = useModalHelp('modal.theme-picker')
  return (
    <ModalShell title="Select theme" help={help} width={uiTokens.modalWidth.md} listGap={0}>
      {THEME_IDS.map((id, index) => {
        const entry = THEMES[id]
        const active = index === selectedIndex
        const isCurrent = id === currentThemeId
        return (
          <ListItem
            key={id}
            active={active}
            title={<text fg={active ? theme.text : theme.textMuted}>{entry.name}</text>}
            trailing={isCurrent ? <text fg={theme.accent}>current</text> : undefined}
          />
        )
      })}
    </ModalShell>
  )
}
