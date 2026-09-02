import type { ModeId } from '@brimveyn/aimux-config'

import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Form } from './form'

interface WorkspaceDeleteConfirmProps {
  keybindsModeId: ModeId
  /**
   * One short line naming what confirming costs beyond the delete itself.
   * Omitted for the ordinary case, where the title already said everything.
   */
  reason?: string
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
      subtitle={workspaceLabel}
      keybindsModeId={keybindsModeId}
      width={uiTokens.modalWidth.md}
      // Destructive confirmation — the one place §7 keeps an inline key hint.
      footer={<text fg={t.textMuted}>Enter / y to delete · Esc / n to cancel</text>}
    >
      {reason == null || reason === '' ? null : <text fg={t.textMuted}>{reason}</text>}
    </Form>
  )
}
