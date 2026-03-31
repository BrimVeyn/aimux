import { theme } from '../theme'

export function SessionNameModal({ title, value }: { title: string; value: string }) {
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
        width={48}
        border
        borderColor={theme.borderActive}
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accentAlt}>{title}</text>
        <text fg={theme.textMuted}>Type a session name. Enter confirm, Esc cancel.</text>
        <box border borderColor={theme.borderActive} backgroundColor={theme.panelMuted} padding={1}>
          <text fg={theme.text}>{value}_</text>
        </box>
      </box>
    </box>
  )
}
