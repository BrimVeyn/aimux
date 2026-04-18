import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ListItem } from './list-item'
import { ModalShell } from './modal-shell'

interface UpdateAvailableModalProps {
  currentVersion: string
  latestVersion: string
  selectedIndex: number
}

const OPTIONS: { label: string }[] = [
  { label: 'Yes, update now' },
  { label: 'No, skip this version' },
]

export function UpdateAvailableModal({
  currentVersion,
  latestVersion,
  selectedIndex,
}: UpdateAvailableModalProps) {
  return (
    <ModalShell
      title="Update available"
      subtitle={`${currentVersion} → ${latestVersion}`}
      keybindsModeId="modal.update-available"
      width={uiTokens.modalWidth.md}
      listGap={1}
    >
      <box flexDirection="row" gap={1} marginTop={1}>
        {OPTIONS.map((option, index) => {
          const active = index === selectedIndex
          return (
            <ListItem
              key={option.label}
              active={active}
              direction="row"
              title={<text fg={active ? theme.text : theme.textMuted}>{option.label}</text>}
            />
          )
        })}
      </box>
    </ModalShell>
  )
}
