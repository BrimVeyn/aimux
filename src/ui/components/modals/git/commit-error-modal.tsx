import { useTokens } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { ModalShell } from '../shared/modal-shell'

interface CommitErrorModalProps {
  stderr: string
  commitTitle: string
  scrollOffset: number
}

const VIEWPORT_LINES = 18

export function CommitErrorModal({ commitTitle, scrollOffset, stderr }: CommitErrorModalProps) {
  const t = useTokens()
  const allLines = stderr.split('\n')
  const totalLines = allLines.length
  const maxOffset = Math.max(0, totalLines - VIEWPORT_LINES)
  const offset = Math.min(scrollOffset, maxOffset)
  const visibleLines = allLines.slice(offset, offset + VIEWPORT_LINES)
  const hasMoreBelow = offset + VIEWPORT_LINES < totalLines
  const hasMoreAbove = offset > 0
  const subtitle = commitTitle
    ? `Message attempted: ${commitTitle}`
    : 'Pre-commit hook rejected the commit'

  return (
    <ModalShell
      title="Commit failed"
      subtitle={subtitle}
      keybindsModeId="modal.git-commit-error"
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column">
        <box flexDirection="row" justifyContent="space-between">
          <text fg={t.muted}>
            {hasMoreAbove ? '↑ more above · ' : ''}
            {totalLines} line{totalLines === 1 ? '' : 's'}
          </text>
          <text fg={t.muted}>{hasMoreBelow ? '↓ more below' : ''}</text>
        </box>
        <box flexDirection="column" marginTop={1}>
          {visibleLines.length === 0 ? (
            <text fg={t.muted}>(empty output)</text>
          ) : (
            visibleLines.map((line, idx) => (
              <text key={`err-${offset + idx}`} fg={t.palette.error}>
                {line.length > 0 ? line : ' '}
              </text>
            ))
          )}
        </box>
      </box>
      <box flexDirection="column" marginTop={1}>
        <text fg={t.palette.primary}>
          <strong>a</strong>
          <text fg={t.muted}> · ask agent to fix (new Claude tab in the diff pane)</text>
        </text>
        <text fg={t.muted}>↑/↓ scroll · Esc dismiss</text>
      </box>
    </ModalShell>
  )
}
