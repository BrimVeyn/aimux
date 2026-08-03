import type { AIUsageTool } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import type { UsagePaceStage, UsageSnapshot, UsageWindow } from '../../../services/ai-usage/types'
import type { ResolvedTuiTheme } from '../../themes'

import { projectWindow } from '../../../services/ai-usage/projection'
import { useAIUsageStore } from '../../../state/ai-usage-store'
import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { formatClock } from './format'
import { GLYPH, Muted, Section, TickBar } from './shared'

/**
 * The live quota block.
 *
 * The one place on the stats screen where a gauge is honest: a quota window is a
 * real fraction of a real ceiling, so the bar means what a bar is supposed to
 * mean. Status colours are reserved for these bars and appear nowhere else.
 */

const TOOL_TITLE: Record<AIUsageTool, string> = { claude: 'Claude', codex: 'Codex' }
const TOOLS: AIUsageTool[] = ['claude', 'codex']

const LABEL_WIDTH = 9
const PERCENT_WIDTH = 5
const SEGMENTS = 16

/** Behind is a warning, ahead is fine, on-track is neither — a state, so a status colour. */
function paceColor(stage: UsagePaceStage, t: ResolvedTuiTheme): string {
  if (stage === 'behind' || stage === 'farBehind' || stage === 'slightlyBehind') return t.warning
  if (stage === 'ahead' || stage === 'farAhead' || stage === 'slightlyAhead') return t.success
  return t.textMuted
}

function formatRelative(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now'
  const s = Math.floor(diffMs / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** `14:20` today, `Thu 14:20` later in the week — enough to act on, no more. */
function formatProjectedTime(at: Date, now: Date): string {
  const clock = formatClock(at.getHours() * 60 + at.getMinutes())
  if (at.toDateString() === now.toDateString()) return clock
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getDay()] ?? ''} ${clock}`
}

/**
 * One window on one line: label, gauge, percent, and whatever context fits in
 * what is left. The pace takes a second line only when there is a pace to
 * report, so an ordinary window costs one row rather than three.
 */
function WindowRow({ now, width, window }: { now: Date; width: number; window: UsageWindow }) {
  const t = useTheme()
  const percent = window.percent ?? 0

  let barColor = t.success
  if (window.percent !== null) {
    if (percent >= 85) barColor = t.error
    else if (percent >= 60) barColor = t.warning
  }

  const projection = projectWindow(window, now)
  const meta: string[] = []
  if (window.timeRemaining != null && window.timeRemaining !== '') {
    meta.push(`resets in ${window.timeRemaining}`)
  }
  if (projection.kind === 'exhausted') {
    meta.push(`empty ~${formatProjectedTime(projection.at, now)}`)
  }
  const metaRoom = width - LABEL_WIDTH - SEGMENTS - PERCENT_WIDTH - 1

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" flexShrink={0}>
        <box width={LABEL_WIDTH} flexShrink={0}>
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {truncate(window.label, LABEL_WIDTH - 1)}
          </text>
        </box>
        <TickBar color={barColor} max={100} segments={SEGMENTS} value={Math.min(100, percent)} />
        <text fg={t.text} selectable={false} wrapMode="none">
          {(window.percent === null ? '—' : `${Math.round(percent)}%`).padStart(PERCENT_WIDTH)}
        </text>
        {meta.length > 0 && metaRoom > 8 ? (
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {` \u{00B7} ${truncate(meta.join(' \u{00B7} '), metaRoom - 3)}`}
          </text>
        ) : null}
      </box>
      {window.pace ? (
        <box paddingLeft={LABEL_WIDTH} flexShrink={0}>
          <text fg={paceColor(window.pace.stage, t)} selectable={false} wrapMode="none">
            {truncate(window.pace.label, width - LABEL_WIDTH)}
          </text>
        </box>
      ) : null}
    </box>
  )
}

function ToolQuotas({
  now,
  snap,
  tool,
  width,
}: {
  now: Date
  snap: UsageSnapshot
  tool: AIUsageTool
  width: number
}) {
  const t = useTheme()
  const isHardError = Boolean(snap.error) && !(snap.stale === true)
  const plan = snap.planTier != null && snap.planTier !== '' ? ` \u{00B7} ${snap.planTier}` : ''

  let body: ReactNode = snap.windows.map((window) => (
    <WindowRow key={window.kind} now={now} width={width} window={window} />
  ))
  if (isHardError) {
    body = (
      <text fg={t.error} selectable={false} wrapMode="none">
        {truncate(`error: ${snap.error ?? ''}`, width)}
      </text>
    )
  } else if (snap.windows.length === 0) {
    body = <Muted>no window data</Muted>
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <box width={width} flexDirection="row" flexShrink={0}>
        <text fg={t.text} selectable={false} wrapMode="none">
          {TOOL_TITLE[tool]}
        </text>
        <box flexGrow={1} flexDirection="row" justifyContent="flex-end">
          <Muted>{`${formatRelative(snap.lastUpdated, now.getTime())}${plan}`}</Muted>
        </box>
      </box>
      {body}
    </box>
  )
}

export function QuotaSection({ now, width }: { now: Date; width: number }) {
  const snapshots = useAIUsageStore((s) => s.snapshots)
  const tools = TOOLS.map((tool) => ({ snap: snapshots[tool], tool })).filter(
    (entry): entry is { snap: UsageSnapshot; tool: AIUsageTool } => entry.snap !== undefined
  )

  return (
    <Section glyph={GLYPH.quota} title="Quotas" note="live" width={width}>
      {tools.length === 0 ? (
        <Muted>no data yet — collecting…</Muted>
      ) : (
        tools.map(({ snap, tool }) => (
          <ToolQuotas key={tool} now={now} snap={snap} tool={tool} width={width} />
        ))
      )}
    </Section>
  )
}
