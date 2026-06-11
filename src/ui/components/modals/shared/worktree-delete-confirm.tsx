import type { ModeId } from '@brimveyn/aimux-config'

import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Form } from './form'

interface WorktreeDeleteConfirmProps {
  keybindsModeId: ModeId
  reason: string
  worktreeLabel: string
}

/**
 * Shared confirmation dialog for a recoverable worktree delete. Used both inside
 * the new-tab picker and as a standalone modal (sidebar "Remove worktree"); the
 * keybinds mode wires Enter/y to confirm and Esc/n to cancel for each context.
 */
export function WorktreeDeleteConfirm({
  keybindsModeId,
  reason,
  worktreeLabel,
}: WorktreeDeleteConfirmProps) {
  const t = useTheme()
  return (
    <Form
      title="Delete worktree?"
      keybindsModeId={keybindsModeId}
      width={uiTokens.modalWidth.md}
      footer={<text fg={t.textMuted}>Enter / y to delete · Esc / n to cancel</text>}
    >
      <box flexDirection="column" gap={1}>
        <text fg={t.text}>
          Delete <strong>{worktreeLabel}</strong>?
        </text>
        <text fg={t.warning}>{reason}</text>
      </box>
    </Form>
  )
}
