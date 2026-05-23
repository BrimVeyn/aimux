import type { WorktreeRecord } from '../../../../state/types'

import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { ListItem } from '../../primitives/list-item'
import { ModalShell } from '../shared/modal-shell'

interface WorktreeMoveModalProps {
  deleteSource: boolean
  divergence: Record<string, { ahead: number; behind: number }>
  selectedIndex: number
  sourceLabel: string
  targets: WorktreeRecord[]
}

function formatDivergence(divergence: { ahead: number; behind: number } | undefined): string {
  if (divergence == null) return ''
  const parts: string[] = []
  if (divergence.ahead > 0) parts.push(`↑${divergence.ahead}`)
  if (divergence.behind > 0) parts.push(`↓${divergence.behind}`)
  return parts.join(' ')
}

export function WorktreeMoveModal({
  deleteSource,
  divergence,
  selectedIndex,
  sourceLabel,
  targets,
}: WorktreeMoveModalProps) {
  const t = useTheme()
  return (
    <ModalShell
      title={`Move ${sourceLabel} →`}
      keybindsModeId="modal.worktree-move"
      width={uiTokens.modalWidth.md}
      footer={
        <box flexDirection="column" gap={0}>
          <text fg={t.textMuted}>{`delete source after move: ${deleteSource ? 'on' : 'off'}`}</text>
          <text fg={t.textMuted}>↵ move · d toggle delete · j/k move · esc cancel</text>
        </box>
      }
    >
      <box flexDirection="column" marginTop={1}>
        {targets.length === 0 ? (
          <text fg={t.textMuted}>No other worktree to move into.</text>
        ) : (
          targets.map((worktree, index) => {
            const active = index === selectedIndex
            const label =
              worktree.branch != null && worktree.branch !== '' ? worktree.branch : worktree.name
            const ahead = formatDivergence(divergence[worktree.id])
            return (
              <ListItem
                key={worktree.id}
                id={worktree.id}
                active={active}
                onHover={() => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
                onClick={() => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
                title={
                  <text fg={active ? t.text : t.textMuted} wrapMode="none">
                    {label}
                    {worktree.source === 'primary' ? ' (primary)' : ''}
                    {ahead !== '' ? ` ${ahead}` : ''}
                  </text>
                }
              />
            )
          })
        )}
      </box>
    </ModalShell>
  )
}
