import { useCallback, useMemo } from 'react'

import type { WorktreeRecord } from '../../../../state/types'

import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { formatDivergence } from '../../../../state/session-worktrees'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { ListItem } from '../../primitives/list-item'
import { ModalShell } from '../shared/modal-shell'

interface WorktreeMoveModalProps {
  deleteSource: boolean
  divergence: Record<string, { ahead: number; behind: number }>
  selectedIndex: number
  sourceWorktreeId: string
  worktrees: WorktreeRecord[]
}

const MOVE_HINTS: [key: string, label: string][] = [
  ['↵', 'move into selected target'],
  ['d', 'toggle delete source'],
  ['j/k', 'change target'],
  ['esc', 'cancel'],
]

export function WorktreeMoveModal({
  deleteSource,
  divergence,
  selectedIndex,
  sourceWorktreeId,
  worktrees,
}: WorktreeMoveModalProps) {
  const t = useTheme()
  const source = useMemo(
    () => worktrees.find((w) => w.id === sourceWorktreeId),
    [sourceWorktreeId, worktrees]
  )
  const targets = useMemo(
    () => worktrees.filter((w) => w.id !== sourceWorktreeId),
    [sourceWorktreeId, worktrees]
  )
  const sourceLabel =
    source?.branch != null && source.branch !== '' ? source.branch : (source?.name ?? 'worktree')
  const handleSelectIndex = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )
  return (
    <ModalShell
      title={`Move ${sourceLabel} →`}
      keybindsModeId="modal.worktree-move"
      width={uiTokens.modalWidth.md}
      footer={
        <box flexDirection="column" gap={1} marginTop={1}>
          <box flexDirection="row" gap={1}>
            <text fg={t.textMuted}>delete source after move</text>
            <text fg={deleteSource ? t.warning : t.text}>{deleteSource ? 'on' : 'off'}</text>
          </box>
          <box flexDirection="column" gap={0}>
            {MOVE_HINTS.map(([key, label]) => (
              <box key={key} flexDirection="row" gap={2}>
                <box width={4} flexShrink={0}>
                  <text fg={t.primary}>{key}</text>
                </box>
                <text fg={t.textMuted}>{label}</text>
              </box>
            ))}
          </box>
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
                index={index}
                active={active}
                onHoverIndex={handleSelectIndex}
                onClickIndex={handleSelectIndex}
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
