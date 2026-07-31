import { memo, useCallback } from 'react'

import type { PrCheck, PrCheckState, PrStatusResult, PrSummary } from '../../../../git/pr-status'

import { openUrl } from '../../../../platform/open-url'
import { usePrStatusStore } from '../../../../state/pr-status-store'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { type ResolvedTuiTheme, useTheme } from '../../../theme'

/** Below this the workflow column crowds out the check name. */
const WORKFLOW_MIN_WIDTH = 34

const HIDDEN_SCROLLBAR_OPTIONS = { visible: false }
const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

const STATE_GLYPH: Record<Exclude<PrCheckState, 'pending'>, string> = {
  cancel: '⊘',
  fail: '✗',
  pass: '✓',
  skipping: '○',
}

function stateColor(state: PrCheckState, t: ResolvedTuiTheme): string {
  if (state === 'pass') return t.success
  if (state === 'fail') return t.error
  if (state === 'pending') return t.warning
  return t.textMuted
}

function prStateColor(pr: PrSummary, t: ResolvedTuiTheme): string {
  if (pr.isDraft) return t.textMuted
  if (pr.state === 'OPEN') return t.success
  if (pr.state === 'MERGED') return t.primary
  return t.error
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
}

function reviewLabel(decision: string): string | null {
  if (decision === 'APPROVED') return '✓ approved'
  if (decision === 'CHANGES_REQUESTED') return '✗ changes requested'
  if (decision === 'REVIEW_REQUIRED') return '· review required'
  return null
}

function placeholder(
  result: PrStatusResult | null,
  t: ResolvedTuiTheme
): { label: string; color: string } | null {
  if (result === null) return { color: t.textMuted, label: '…' }
  if (result.kind === 'no-gh') return { color: t.textMuted, label: 'gh CLI not found' }
  if (result.kind === 'no-pr') return { color: t.textMuted, label: 'No pull request' }
  if (result.kind === 'error') return { color: t.error, label: result.message }
  return null
}

const CheckRow = memo(function CheckRow({
  check,
  showWorkflow,
  spinner,
}: {
  check: PrCheck
  showWorkflow: boolean
  spinner: string
}) {
  const t = useTheme()
  const onOpen = useCallback(() => {
    openUrl(check.url)
  }, [check.url])
  const glyph = check.state === 'pending' ? spinner : STATE_GLYPH[check.state]
  return (
    <box flexDirection="row" gap={1} onMouseDown={onOpen}>
      <box width={1} flexShrink={0}>
        <text selectable={false} fg={stateColor(check.state, t)}>
          {glyph}
        </text>
      </box>
      <box flexGrow={1} overflow="hidden">
        <text selectable={false} fg={t.text} wrapMode="none">
          {check.name}
        </text>
      </box>
      {showWorkflow && check.workflow !== '' ? (
        <box flexShrink={0}>
          <text selectable={false} fg={t.textMuted} wrapMode="none">
            {check.workflow}
          </text>
        </box>
      ) : null}
      <box flexShrink={0}>
        <text selectable={false} fg={t.textMuted} wrapMode="none">
          {formatDuration(check.durationMs)}
        </text>
      </box>
    </box>
  )
})

const PrSummaryBlock = memo(function PrSummaryBlock({
  contentWidth,
  pr,
  stale,
}: {
  pr: PrSummary
  contentWidth: number
  stale: boolean
}) {
  const t = useTheme()
  const onOpen = useCallback(() => {
    openUrl(pr.url)
  }, [pr.url])
  const review = reviewLabel(pr.reviewDecision)
  return (
    <box flexDirection="column" flexShrink={0} onMouseDown={onOpen}>
      <box flexDirection="row" gap={1}>
        <box flexShrink={0}>
          <text selectable={false} fg={t.textMuted} wrapMode="none">
            #{pr.number}
          </text>
        </box>
        <box flexShrink={0}>
          <text selectable={false} fg={prStateColor(pr, t)} wrapMode="none">
            <strong>{pr.isDraft ? 'DRAFT' : pr.state}</strong>
          </text>
        </box>
        <box flexGrow={1} overflow="hidden">
          <text selectable={false} fg={stale ? t.textMuted : t.text} wrapMode="none">
            {pr.title}
          </text>
        </box>
      </box>
      <box overflow="hidden">
        <text selectable={false} fg={t.textMuted} wrapMode="none">
          {pr.base} ← {pr.head}
        </text>
      </box>
      <box flexDirection="row" gap={1} overflow="hidden">
        {review !== null ? (
          <box flexShrink={0}>
            <text
              selectable={false}
              fg={pr.reviewDecision === 'CHANGES_REQUESTED' ? t.error : t.textMuted}
              wrapMode="none"
            >
              {review}
            </text>
          </box>
        ) : null}
        <box flexShrink={0}>
          <text selectable={false} fg={t.diffAdded} wrapMode="none">
            +{pr.additions}
          </text>
        </box>
        <box flexShrink={0}>
          <text selectable={false} fg={t.diffRemoved} wrapMode="none">
            −{pr.deletions}
          </text>
        </box>
        <box flexShrink={1} overflow="hidden">
          <text selectable={false} fg={t.textMuted} wrapMode="none">
            {pr.changedFiles}f
          </text>
        </box>
      </box>
      <box paddingTop={0}>
        <text selectable={false} fg={t.borderSubtle} wrapMode="none">
          {'─'.repeat(Math.max(1, contentWidth))}
        </text>
      </box>
    </box>
  )
})

export const PrChecksPanel = memo(function PrChecksPanel({
  contentWidth,
}: {
  contentWidth: number
}) {
  const t = useTheme()
  const result = usePrStatusStore((s) => s.result)
  const stale = usePrStatusStore((s) => s.stale)

  const checks = result?.kind === 'ok' ? result.checks : []
  const spinner = useBusySpinner(checks.some((c) => c.state === 'pending'))

  const status = placeholder(result, t)
  if (status !== null || result?.kind !== 'ok') {
    return (
      <box flexGrow={1} flexDirection="column" alignItems="center" paddingTop={1}>
        <text selectable={false} fg={status?.color ?? t.textMuted}>
          {status?.label ?? '…'}
        </text>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden">
      <PrSummaryBlock contentWidth={contentWidth} pr={result.pr} stale={stale} />
      {checks.length === 0 ? (
        <box flexGrow={1} flexDirection="column" alignItems="center" paddingTop={1}>
          <text selectable={false} fg={t.textMuted}>
            No checks
          </text>
        </box>
      ) : (
        <scrollbox
          flexGrow={1}
          scrollY
          scrollbarOptions={HIDDEN_SCROLLBAR_OPTIONS}
          viewportCulling
          contentOptions={COLUMN_CONTENT_OPTIONS}
        >
          {checks.map((check) => (
            <CheckRow
              key={`${check.workflow}/${check.name}`}
              check={check}
              showWorkflow={contentWidth >= WORKFLOW_MIN_WIDTH}
              spinner={spinner}
            />
          ))}
        </scrollbox>
      )}
    </box>
  )
})
