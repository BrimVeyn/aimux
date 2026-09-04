import { formatChord } from '../../../../input/keymap/key-format'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { ModalShell } from '../shared/modal-shell'

export function SettingKeybindModal({
  captured,
  conflict,
  label,
}: {
  captured: readonly string[]
  conflict: string | null
  label: string
}) {
  const t = useTheme()
  return (
    <ModalShell title={label} width={uiTokens.modalWidth.md}>
      <text fg={captured.length === 0 ? t.textMuted : t.text}>
        {captured.length === 0
          ? 'Press a key combination…'
          : captured.map((chord) => formatChord(chord)).join(' ')}
      </text>
      <text fg={t.textMuted}>Esc cancels · Enter confirms · Backspace removes</text>
      {conflict === null ? null : <text fg={t.warning}>Already bound to {conflict}</text>}
    </ModalShell>
  )
}
