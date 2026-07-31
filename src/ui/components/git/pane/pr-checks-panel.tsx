import { memo, useCallback, useState } from 'react'

import {
  clampPrBody,
  type PrCheck,
  type PrCheckState,
  type PrStatusResult,
} from '../../../../git/pr-status'
import { openUrl } from '../../../../platform/open-url'
import { usePrStatusStore } from '../../../../state/pr-status-store'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { type ResolvedTuiTheme, useTheme, useTransparent } from '../../../theme'

/** Below this the workflow column crowds out the check name. */
const WORKFLOW_MIN_WIDTH = 34

const HIDDEN_SCROLLBAR_OPTIONS = { visible: false }
/** gap 1 separates title / body / checks; the rows inside stay tight. */
const AIRY_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 1 }

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

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
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
  bg,
  check,
  showWorkflow,
  spinner,
}: {
  check: PrCheck
  showWorkflow: boolean
  spinner: string
  bg: string | undefined
}) {
  const t = useTheme()
  const onOpen = useCallback(() => {
    openUrl(check.url)
  }, [check.url])
  const glyph = check.state === 'pending' ? spinner : STATE_GLYPH[check.state]
  return (
    <box flexDirection="row" gap={1} onMouseDown={onOpen}>
      <box width={1} flexShrink={0}>
        <text selectable={false} fg={stateColor(check.state, t)} bg={bg}>
          {glyph}
        </text>
      </box>
      <box flexGrow={1} overflow="hidden">
        <text selectable={false} fg={t.text} bg={bg} wrapMode="none">
          {check.name}
        </text>
      </box>
      {showWorkflow && check.workflow !== '' ? (
        <box flexShrink={0}>
          <text selectable={false} fg={t.textMuted} bg={bg} wrapMode="none">
            {check.workflow}
          </text>
        </box>
      ) : null}
      <box flexShrink={0}>
        <text selectable={false} fg={t.textMuted} bg={bg} wrapMode="none">
          {formatDuration(check.durationMs)}
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
  // A tone apart from the PR state row above, so the two zones read as
  // separate bands. Transparent mode paints neither.
  const transparent = useTransparent()
  const bg = transparent ? undefined : t.backgroundPanel
  const result = usePrStatusStore((s) => s.result)
  const stale = usePrStatusStore((s) => s.stale)
  const [expanded, setExpanded] = useState(false)
  const toggleBody = useCallback(() => setExpanded((prev) => !prev), [])

  const checks = result?.kind === 'ok' ? result.checks : []
  const spinner = useBusySpinner(checks.some((c) => c.state === 'pending'))

  const status = placeholder(result, t)
  if (status !== null || result?.kind !== 'ok') {
    return (
      <box
        flexGrow={1}
        flexDirection="column"
        alignItems="center"
        backgroundColor={bg}
        paddingTop={1}
      >
        <text selectable={false} fg={status?.color ?? t.textMuted} bg={bg}>
          {status?.label ?? '…'}
        </text>
      </box>
    )
  }

  const pr = result.pr
  // The padding below costs a column on each side.
  const innerWidth = contentWidth - 2
  const clamped = clampPrBody(pr.body)
  const body = expanded ? pr.body.trimEnd() : clamped.text
  // The body is raw markdown on purpose: rendering it would cost a parser and
  // the source is what a PR author actually wrote.
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      overflow="hidden"
      backgroundColor={bg}
      padding={1}
    >
      {/* No viewportCulling here — the wrapped body is one tall child, which
          culling measures badly, and the content is a description plus a
          handful of rows either way. */}
      <scrollbox
        flexGrow={1}
        scrollY
        scrollbarOptions={HIDDEN_SCROLLBAR_OPTIONS}
        contentOptions={AIRY_CONTENT_OPTIONS}
      >
        <text selectable={false} fg={stale ? t.textMuted : t.text} bg={bg}>
          <strong>{pr.title}</strong>
        </text>
        {body !== '' ? (
          <box flexDirection="column">
            <text selectable={false} fg={t.textMuted} bg={bg}>
              {body}
            </text>
            {clamped.truncated ? (
              <text selectable={false} fg={t.primary} bg={bg} onMouseDown={toggleBody}>
                {expanded ? '▴ less' : '▾ more'}
              </text>
            ) : null}
          </box>
        ) : null}
        <box flexDirection="column">
          <text selectable={false} fg={t.textMuted} bg={bg}>
            Checks
          </text>
          {checks.length === 0 ? (
            <text selectable={false} fg={t.textMuted} bg={bg}>
              No checks
            </text>
          ) : (
            checks.map((check) => (
              <CheckRow
                key={`${check.workflow}/${check.name}`}
                bg={bg}
                check={check}
                showWorkflow={innerWidth >= WORKFLOW_MIN_WIDTH}
                spinner={spinner}
              />
            ))
          )}
        </box>
      </scrollbox>
    </box>
  )
})
