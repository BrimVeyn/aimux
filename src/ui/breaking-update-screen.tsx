import { useKeyboard } from '@opentui/react'

import { ModalShell } from './components/modals/shared/modal-shell'
import { ListItem } from './components/primitives/list-item'
import { useSelectionInk } from './selection-ink'
import { useTheme } from './theme'
import { uiTokens } from './ui-tokens'

interface BreakingUpdateScreenProps {
  onConfirm: () => void
}

export function BreakingUpdateScreen({ onConfirm }: BreakingUpdateScreenProps) {
  const t = useTheme()
  const ink = useSelectionInk()
  useKeyboard((key) => {
    if (key.name === 'return') {
      key.preventDefault()
      onConfirm()
    }
  })

  // Drawn before App, so no keybind overlay exists to show the key: it sits
  // under the one control, the way a forced confirmation is allowed to (§7).
  return (
    <ModalShell
      title="Breaking update"
      subtitle="The terminal manager has to restart. Each tab comes back when you open it."
      width={uiTokens.modalWidth.md}
      footer={<text fg={t.textMuted}>Enter to restart</text>}
    >
      <ListItem active direction="row" title={<text fg={ink}>Restart terminal manager</text>} />
    </ModalShell>
  )
}
