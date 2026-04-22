import { useKeyboard } from '@opentui/react'

import { ModalShell } from './components/modals/shared/modal-shell'
import { ListItem } from './components/primitives/list-item'
import { uiTokens } from './ui-tokens'

interface BreakingUpdateScreenProps {
  onConfirm: () => void
}

export function BreakingUpdateScreen({ onConfirm }: BreakingUpdateScreenProps) {
  useKeyboard((key) => {
    if (key.name === 'return') {
      key.preventDefault()
      onConfirm()
    }
  })

  return (
    <ModalShell title="Breaking update detected" width={uiTokens.modalWidth.md}>
      <box flexDirection="column" gap={1}>
        <box flexDirection="column" gap={0}>
          <text>{"We're sorry, but this update contains breaking protocol changes."}</text>
          <text>The terminal manager must be restarted.</text>
          <text>You will lose your current terminal states.</text>
        </box>
        <ListItem active direction="row" title={<text>OK — Restart terminal manager</text>} />
      </box>
    </ModalShell>
  )
}
