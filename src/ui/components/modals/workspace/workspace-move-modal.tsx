import { useCallback, useMemo } from 'react'

import type { ModalWorkspaceMove, WorkspaceRecord } from '../../../../state/types'

import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { formatDivergence } from '../../../../state/project-workspaces'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { ListItem } from '../../primitives/list-item'
import { ModalShell } from '../shared/modal-shell'

interface WorkspaceMoveModalProps {
  deleteSource: boolean
  divergence: Record<string, { ahead: number; behind: number }>
  selectedIndex: number
  sourceWorkspaceId: string
  stats: ModalWorkspaceMove['stats']
  workspaces: WorkspaceRecord[]
}

const MOVE_HINTS: [key: string, label: string][] = [
  ['↵', 'move into selected target'],
  ['d', 'toggle delete source'],
  ['j/k', 'change target'],
  ['esc', 'cancel'],
]

export function WorkspaceMoveModal({
  deleteSource,
  divergence,
  selectedIndex,
  sourceWorkspaceId,
  stats,
  workspaces,
}: WorkspaceMoveModalProps) {
  const t = useTheme()
  const source = useMemo(
    () => workspaces.find((w) => w.id === sourceWorkspaceId),
    [sourceWorkspaceId, workspaces]
  )
  const targets = useMemo(
    () => workspaces.filter((w) => w.id !== sourceWorkspaceId),
    [sourceWorkspaceId, workspaces]
  )
  const sourceLabel =
    source?.branch != null && source.branch !== '' ? source.branch : (source?.name ?? 'workspace')
  // What the move would carry: commits ahead of the fork point (when known) plus
  // uncommitted files, loaded async after the modal opens.
  const sourcePreview = useMemo(() => {
    const parts: string[] = []
    const ahead = divergence[sourceWorkspaceId]?.ahead ?? 0
    if (ahead > 0) parts.push(`${ahead} commit(s)`)
    if (stats.kind === 'ready') {
      const dirty = stats.dirtyFiles[sourceWorkspaceId] ?? 0
      if (dirty > 0) parts.push(`${dirty} uncommitted file(s)`)
    }
    return parts.join(' · ')
  }, [divergence, sourceWorkspaceId, stats])
  const handleSelectIndex = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )
  return (
    <ModalShell
      title={`Move ${sourceLabel} →`}
      keybindsModeId="modal.workspace-move"
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
        {sourcePreview !== '' ? <text fg={t.textMuted}>will move: {sourcePreview}</text> : null}
        {targets.length === 0 ? (
          <text fg={t.textMuted}>No other workspace to move into.</text>
        ) : (
          targets.map((workspace, index) => {
            const active = index === selectedIndex
            const label =
              workspace.branch != null && workspace.branch !== ''
                ? workspace.branch
                : workspace.name
            const ahead = formatDivergence(divergence[workspace.id])
            const dirty = stats.kind === 'ready' && (stats.dirtyFiles[workspace.id] ?? 0) > 0
            return (
              <ListItem
                key={workspace.id}
                id={workspace.id}
                index={index}
                active={active}
                onHoverIndex={handleSelectIndex}
                onClickIndex={handleSelectIndex}
                title={
                  <text fg={active ? t.text : t.textMuted} wrapMode="none">
                    {label}
                    {workspace.source === 'primary' ? ' (primary)' : ''}
                    {ahead !== '' ? ` ${ahead}` : ''}
                    {dirty ? <span fg={t.warning}> ●</span> : null}
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
