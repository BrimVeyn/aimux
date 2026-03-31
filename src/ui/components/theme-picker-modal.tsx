import { theme } from '../theme'
import { type ThemeId, THEMES, THEME_IDS } from '../themes'

interface ThemePickerModalProps {
  selectedIndex: number
  currentThemeId: ThemeId
}

export function ThemePickerModal({ selectedIndex, currentThemeId }: ThemePickerModalProps) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={40}
        border
        borderColor={theme.borderActive}
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accent}>Select theme</text>
        <text fg={theme.textMuted}>j/k move, Enter confirm, Esc cancel.</text>
        {THEME_IDS.map((id, index) => {
          const entry = THEMES[id]
          const active = index === selectedIndex
          const isCurrent = id === currentThemeId
          return (
            <box key={id} flexDirection="row">
              <text fg={active ? theme.text : theme.textMuted}>
                {active ? '>' : ' '} {entry.name}
              </text>
              {isCurrent ? <text fg={theme.accent}> *</text> : null}
            </box>
          )
        })}
      </box>
    </box>
  )
}
