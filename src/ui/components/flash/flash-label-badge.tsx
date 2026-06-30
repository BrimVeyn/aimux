import { memo } from 'react'

import { useFlashLabel } from '../../hooks/use-flash-label'
import { useTheme } from '../../theme'

interface FlashLabelBadgeProps {
  rowKey: string
}

/**
 * Tiny inline badge that renders the flash-jump letter(s) for a row.
 * Renders nothing when no flash-jump modal is open or the row has no label.
 * The matched prefix is dimmed; the remaining letters show in accent.
 */
export const FlashLabelBadge = memo(function FlashLabelBadge({ rowKey }: FlashLabelBadgeProps) {
  const t = useTheme()
  const view = useFlashLabel(rowKey)
  if (view === null) return null
  if (!view.isActive) {
    return (
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {view.label}{' '}
      </text>
    )
  }
  return (
    <box flexDirection="row" flexShrink={0}>
      {view.matchedLen > 0 ? (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {view.label.slice(0, view.matchedLen)}
        </text>
      ) : null}
      <text fg={t.accent} selectable={false} wrapMode="none">
        {view.remaining}{' '}
      </text>
    </box>
  )
})
