import type { ModeId } from '@brimveyn/aimux-config'

import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Form } from './form'

interface WorkspaceDeleteConfirmProps {
  keybindsModeId: ModeId
  reason: string
  workspaceLabel: string
}

/**
 * Shared confirmation dialog for a recoverable workspace delete. Used both inside
 * the new-tab picker and as a standalone modal (sidebar "Remove workspace"); the
 * keybinds mode wires Enter/y to confirm and Esc/n to cancel for each context.
 */
export function WorkspaceDeleteConfirm({
  keybindsModeId,
  reason,
  workspaceLabel,
}: WorkspaceDeleteConfirmProps) {
  const t = useTheme()
  return (
    <Form
      title="Delete workspace?"
      keybindsModeId={keybindsModeId}
      width={uiTokens.modalWidth.md}
      footer={<text fg={t.textMuted}>Enter / y to delete · Esc / n to cancel</text>}
    >
      <box flexDirection="column" gap={1}>
        <text fg={t.text}>
          Delete <strong>{workspaceLabel}</strong>?
        </text>
        <text fg={t.warning}>{reason}</text>
      </box>
    </Form>
  )
}
