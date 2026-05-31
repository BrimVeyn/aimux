import { memo } from 'react'

import type { BranchDivergence } from '../../../state/types'

import { useTheme } from '../../theme'

const WORKTREE_STRIP = '▍'

export function formatDivergence(divergence: BranchDivergence | undefined): string {
  if (divergence == null) return ''
  const parts: string[] = []
  if (divergence.ahead > 0) parts.push(`↑${divergence.ahead}`)
  if (divergence.behind > 0) parts.push(`↓${divergence.behind}`)
  return parts.join(' ')
}

interface WorktreeChipProps {
  branch: string
  color: string
  divergence?: BranchDivergence
  paddingLeft?: number
  paddingRight?: number
}

export const WorktreeChip = memo(function WorktreeChip({
  branch,
  color,
  divergence,
  paddingLeft = 1,
  paddingRight = 1,
}: WorktreeChipProps) {
  const t = useTheme()
  const divergenceText = formatDivergence(divergence)
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={paddingLeft}
      paddingRight={paddingRight}
      alignItems="center"
    >
      <text fg={color} selectable={false} wrapMode="none">
        {WORKTREE_STRIP} {branch}
      </text>
      {divergenceText !== '' ? (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {' '}
          {divergenceText}
        </text>
      ) : null}
    </box>
  )
})
