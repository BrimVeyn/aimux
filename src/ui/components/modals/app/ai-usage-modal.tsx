import type { AIUsageTool } from '@brimveyn/aimux-config'

import { useTerminalDimensions } from '@opentui/react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import type {
  UsagePaceStage,
  UsageSnapshot,
  UsageWindow,
} from '../../../../services/ai-usage/types'

import {
  buildHeatmap,
  coveredWeeks,
  formatCompact,
  groupDigits,
  type HeatmapCell,
  mixHex,
  monthRuler,
  promptCounts,
  summarizeDays,
} from '../../../../services/usage-history/stats'
import {
  readUsageHistory,
  type UsageDays,
  type UsageHistoryFile,
} from '../../../../services/usage-history/store'
import { useAIUsageStore } from '../../../../state/ai-usage-store'
import { useTheme } from '../../../theme'
import { truncate } from '../../../truncate'
import { uiTokens } from '../../../ui-tokens'
import { ModalShell } from '../shared/modal-shell'

const TOOL_TITLE: Record<AIUsageTool, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

const BAR_SEGMENTS = 32
const BAR_FILLED_CHAR = '\u{2501}'
const BAR_EMPTY_CHAR = '\u{2500}'

function buildBar(percent: number | null): { empty: string; filled: string } {
  const p = percent ?? 0
  let filledCount = 0
  for (let i = 0; i < BAR_SEGMENTS; i++) {
    if (p > i * (100 / BAR_SEGMENTS)) filledCount++
  }
  return {
    empty: BAR_EMPTY_CHAR.repeat(BAR_SEGMENTS - filledCount),
    filled: BAR_FILLED_CHAR.repeat(filledCount),
  }
}

function formatRelative(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now'
  const s = Math.floor(diffMs / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function paceStageIsAhead(stage: UsagePaceStage): boolean {
  return stage === 'ahead' || stage === 'farAhead' || stage === 'slightlyAhead'
}

function paceStageIsBehind(stage: UsagePaceStage): boolean {
  return stage === 'behind' || stage === 'farBehind' || stage === 'slightlyBehind'
}

const TOOLS: AIUsageTool[] = ['claude', 'codex']
const PAGE_LABELS = ['Live', 'History'] as const

/**
 * A year of weeks plus the weekday gutter needs ~58 columns on its own, and the
 * model and branch tables want two readable columns under it. So the History
 * page takes the terminal, where the Live page stays a compact popover.
 */
const HISTORY_MAX_WIDTH = 104

export function AIUsageModal({ page }: { page: number }) {
  const dimensions = useTerminalDimensions()
  const isHistory = page === 1

  const width = isHistory
    ? Math.max(uiTokens.modalWidth.md, Math.min(HISTORY_MAX_WIDTH, dimensions.width - 8))
    : uiTokens.modalWidth.md

  return (
    <ModalShell title="AI usage" keybindsModeId="modal.ai-usage" width={width} listGap={1}>
      <PageTabs active={page} />
      {isHistory ? <HistoryPage width={width} /> : <LivePage />}
    </ModalShell>
  )
}

function PageTabs({ active }: { active: number }) {
  const t = useTheme()
  return (
    <box flexDirection="row" gap={2}>
      {PAGE_LABELS.map((label, index) => (
        <text key={label} fg={index === active ? t.text : t.textMuted} selectable={false}>
          {label}
        </text>
      ))}
    </box>
  )
}

function LivePage() {
  const t = useTheme()
  const snapshots = useAIUsageStore((s) => s.snapshots)

  const sections = TOOLS.map((tool) => ({ snap: snapshots[tool], tool })).filter(
    (s): s is { snap: UsageSnapshot; tool: AIUsageTool } => s.snap !== undefined
  )

  if (sections.length === 0) {
    return (
      <text fg={t.textMuted} selectable={false}>
        no data yet — collecting…
      </text>
    )
  }

  return (
    <box flexDirection="column" gap={1}>
      {sections.map(({ snap, tool }) => (
        <ToolSection key={tool} snap={snap} tool={tool} />
      ))}
    </box>
  )
}

interface ToolSectionProps {
  snap: UsageSnapshot
  tool: AIUsageTool
}

function ToolSection({ snap, tool }: ToolSectionProps) {
  const t = useTheme()
  const isHardError = Boolean(snap.error) && !(snap.stale === true)
  const relative = formatRelative(snap.lastUpdated)

  let body: ReactNode
  if (isHardError) {
    body = (
      <text fg={t.error} selectable={false}>
        {`error: ${snap.error ?? ''}`}
      </text>
    )
  } else if (snap.windows.length === 0) {
    body = (
      <text fg={t.textMuted} selectable={false}>
        no window data
      </text>
    )
  } else {
    body = snap.windows.map((window) => <WindowRow key={window.kind} window={window} />)
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={t.text} selectable={false}>
          {TOOL_TITLE[tool]}
        </text>
        {snap.planTier != null && snap.planTier !== '' ? (
          <text fg={t.textMuted} selectable={false}>
            {snap.planTier}
          </text>
        ) : null}
      </box>
      <text fg={t.textMuted} selectable={false}>
        {`Updated ${relative}`}
      </text>
      {body}
    </box>
  )
}

function WindowRow({ window }: { window: UsageWindow }) {
  const t = useTheme()
  const percent = window.percent
  const { empty, filled } = buildBar(percent)

  let barColor = t.success
  if (percent !== null) {
    if (percent >= 85) barColor = t.error
    else if (percent >= 60) barColor = t.warning
  }

  const pctText = percent === null ? '—' : `${Math.round(percent)}% used`
  const resetText =
    window.timeRemaining != null && window.timeRemaining !== ''
      ? `Resets in ${window.timeRemaining}`
      : null

  return (
    <box flexDirection="column" paddingTop={1}>
      <text fg={t.text} selectable={false}>
        {window.label}
      </text>
      <box flexDirection="row">
        <text fg={barColor} selectable={false}>
          {filled}
        </text>
        <text fg={t.textMuted} selectable={false}>
          {empty}
        </text>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={t.textMuted} selectable={false}>
          {pctText}
        </text>
        {resetText != null && resetText !== '' ? (
          <text fg={t.textMuted} selectable={false}>
            {resetText}
          </text>
        ) : null}
      </box>
      {window.pace ? <PaceLine pace={window.pace} /> : null}
    </box>
  )
}

function PaceLine({ pace }: { pace: NonNullable<UsageWindow['pace']> }) {
  const t = useTheme()
  let color = t.textMuted
  if (paceStageIsBehind(pace.stage)) color = t.warning
  else if (paceStageIsAhead(pace.stage)) color = t.success

  const suffix = pace.rightText != null && pace.rightText !== '' ? ` · ${pace.rightText}` : ''
  return (
    <text fg={color} selectable={false}>
      {`Pace: ${pace.label}${suffix}`}
    </text>
  )
}

/**
 * One solid block per day, shaded by an interpolated ramp — the same idea as a
 * contributions graph. Earlier this varied the glyph (`░▒▓█`) instead, which on
 * a real palette produced a single indistinct mass.
 */
const CELL = '\u{2588}'
const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''] as const
const ROW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const GUTTER = 5
const COLUMN_GAP = 3

/**
 * Fixed-width gutter in front of every grid row.
 *
 * The width lives on the box, never on the text: an empty <text> is not zero
 * columns wide, so a row labelled `Mon` and an unlabelled one padded to match
 * did not start at the same column, and the grid came out as a brick wall.
 * Inside a single string padding is fine — across sibling nodes it is not.
 */
function Gutter({ label }: { label: string }) {
  const t = useTheme()
  return (
    <box width={GUTTER} flexShrink={0}>
      <text fg={t.textMuted} selectable={false}>
        {label}
      </text>
    </box>
  )
}

function SectionHeader({ label, note }: { label: string; note?: string }) {
  const t = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={t.textMuted} selectable={false}>
        {label}
      </text>
      {note != null && note !== '' ? (
        <text fg={t.textMuted} selectable={false}>
          {note}
        </text>
      ) : null}
    </box>
  )
}

function LabelledRow({ label, value, width }: { label: string; value: string; width: number }) {
  const t = useTheme()
  return (
    <box flexDirection="row">
      <box width={width} flexShrink={0}>
        <text fg={t.textMuted} selectable={false}>
          {label}
        </text>
      </box>
      <text fg={t.text} selectable={false}>
        {value}
      </text>
    </box>
  )
}

function HeatRow({
  cells,
  cellWidth,
  label,
  ramp,
}: {
  cells: HeatmapCell[]
  cellWidth: number
  label: string
  ramp: string[]
}) {
  const t = useTheme()

  // One <text> per colour run rather than per cell: a full year is 371 cells a
  // grid, and the renderer already batches its bars the same way.
  const runs: { color: string; start: number; text: string }[] = []
  for (const [index, cell] of cells.entries()) {
    const color = ramp[cell.level] ?? t.textMuted
    const glyph = (cell.day === '' ? ' ' : CELL).repeat(cellWidth)
    const last = runs.at(-1)
    if (last !== undefined && last.color === color) last.text += glyph
    else runs.push({ color, start: index, text: glyph })
  }

  return (
    <box flexDirection="row">
      <Gutter label={label} />
      {runs.map((run) => (
        <text key={run.start} fg={run.color} selectable={false}>
          {run.text}
        </text>
      ))}
    </box>
  )
}

function Legend({ cellWidth, ramp }: { cellWidth: number; ramp: string[] }) {
  const t = useTheme()
  return (
    <box flexDirection="row">
      <Gutter label="" />
      <text fg={t.textMuted} selectable={false}>
        less
      </text>
      <box width={1} flexShrink={0} />
      {ramp.map((color, index) => (
        <text key={color + String(index)} fg={color} selectable={false}>
          {CELL.repeat(cellWidth)}
        </text>
      ))}
      <box width={1} flexShrink={0} />
      <text fg={t.textMuted} selectable={false}>
        more
      </text>
    </box>
  )
}

/** Right-hand `  2.8B  45%` block, fixed so values line up down the column. */
const VALUE_WIDTH = 12
/** Names longer than this are truncated rather than widening the whole table. */
const NAME_CAP = 26

/** `name ······ 2.8B  45%`, exactly `width` columns, padding kept interior. */
function entryLine(name: string, value: number, total: number, width: number): string {
  const share = total > 0 ? `${Math.round((value / total) * 100)}%` : ''
  const right = `${formatCompact(value).padStart(7)}${share.padStart(5)}`
  const nameWidth = Math.max(4, width - right.length)
  return truncate(name, nameWidth).padEnd(nameWidth) + right
}

interface TopTableProps {
  columnWidth: number
  leftEntries: [string, number][]
  leftTitle: string
  leftTotal: number
  rightEntries: [string, number][]
  rightTitle: string
  rightTotal: number
}

function TopTable(props: TopTableProps) {
  const t = useTheme()
  const { columnWidth, leftEntries, leftTotal, rightEntries, rightTotal } = props
  const stride = columnWidth + COLUMN_GAP

  const rowCount = Math.max(leftEntries.length, rightEntries.length)
  const rows: string[] = []
  for (let index = 0; index < rowCount; index++) {
    const l = leftEntries[index]
    const r = rightEntries[index]
    const leftText = l === undefined ? '' : entryLine(l[0], l[1], leftTotal, columnWidth)
    const rightText = r === undefined ? '' : entryLine(r[0], r[1], rightTotal, columnWidth)
    rows.push(leftText.padEnd(stride) + rightText)
  }

  return (
    <box flexDirection="column">
      <text fg={t.textMuted} selectable={false}>
        {props.leftTitle.padEnd(stride) + props.rightTitle}
      </text>
      {rows.map((row, index) => (
        <text key={`${String(index)}:${row.slice(0, 8)}`} fg={t.text} selectable={false}>
          {row}
        </text>
      ))}
    </box>
  )
}

function HistoryPage({ width }: { width: number }) {
  const t = useTheme()
  const [history, setHistory] = useState<UsageHistoryFile | null>(null)

  useEffect(() => {
    // Synchronous, and ~100 KB even after a full year of rollups.
    setHistory(readUsageHistory())
  }, [])

  // Anchored on borderSubtle rather than a background token so the empty cells
  // stay visible in transparent mode, where backgrounds resolve to alpha 0.
  // Above the early returns: hooks cannot sit behind a conditional.
  const ramp = useMemo(
    () => [
      t.borderSubtle,
      mixHex(t.borderSubtle, t.success, 0.35),
      mixHex(t.borderSubtle, t.success, 0.6),
      mixHex(t.borderSubtle, t.success, 0.82),
      t.success,
    ],
    [t.borderSubtle, t.success]
  )

  if (history === null) {
    return (
      <text fg={t.textMuted} selectable={false}>
        reading history…
      </text>
    )
  }

  const claude: UsageDays = history.tools.claude ?? {}
  const codex: UsageDays = history.tools.codex ?? {}

  if (Object.keys(claude).length === 0 && Object.keys(codex).length === 0) {
    return (
      <text fg={t.textMuted} selectable={false}>
        no history yet — the first rollup runs in the background; reopen in a minute
      </text>
    )
  }

  const inner = width - 4
  const today = new Date()
  // Bounded by what is actually recorded: opening on a wall of empty cells for
  // months that predate the first rollup reads as broken, not as "no data".
  const weeks = coveredWeeks(claude, today, Math.max(4, Math.min(53, inner - GUTTER)))
  // Terminal cells are about twice as tall as they are wide, so a day drawn two
  // columns across is roughly square. Worth it only while the grid still fits.
  const cellWidth = weeks * 2 + GUTTER <= inner ? 2 : 1
  const grid = buildHeatmap(promptCounts(claude), weeks, today)
  const summary = summarizeDays(claude)
  const codexSummary = summarizeDays(codex)

  const average =
    summary.promptDays === 0 ? 0 : Math.round(summary.totalPrompts / summary.promptDays)
  const { tokens } = summary
  // Both columns the same width, driven by the longest name across the two and
  // capped rather than stretched to the modal. Sizing each column to its own
  // longest name gave the tables unrelated geometries and left `main` stranded
  // 45 columns from its own number.
  const affordable = Math.max(12, Math.floor((inner - COLUMN_GAP) / 2) - VALUE_WIDTH)
  let longestName = 0
  for (const [name] of summary.models) longestName = Math.max(longestName, name.length)
  for (const [name] of summary.branches) longestName = Math.max(longestName, name.length)
  const columnWidth = Math.max(12, Math.min(NAME_CAP, affordable, longestName)) + VALUE_WIDTH
  const labelWidth = 11

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="column">
        <SectionHeader
          label="ACTIVITY"
          note={`${groupDigits(summary.totalPrompts)} prompts over ${summary.promptDays} days · ${average} avg · ${summary.peakPrompts} peak`}
        />
        <box flexDirection="row">
          <Gutter label="" />
          <text fg={t.textMuted} selectable={false}>
            {monthRuler(grid, weeks, cellWidth)}
          </text>
        </box>
        {grid.map((cells, index) => (
          <HeatRow
            key={ROW_KEYS[index]}
            cells={cells}
            cellWidth={cellWidth}
            label={ROW_LABELS[index] ?? ''}
            ramp={ramp}
          />
        ))}
        <Legend cellWidth={cellWidth} ramp={ramp} />
      </box>

      <box flexDirection="column">
        <SectionHeader
          label="TOKENS"
          note={`${summary.tokenDays} days retained · ${formatCompact(tokens.total)} total`}
        />
        <LabelledRow label="input" value={formatCompact(tokens.input)} width={labelWidth} />
        <LabelledRow label="output" value={formatCompact(tokens.output)} width={labelWidth} />
        <LabelledRow
          label="cache"
          value={`${formatCompact(tokens.cacheRead)} read · ${formatCompact(tokens.cacheWrite)} written`}
          width={labelWidth}
        />
        {codexSummary.tokens.total > 0 ? (
          <LabelledRow
            label="codex"
            value={`${formatCompact(codexSummary.tokens.total)} over ${codexSummary.tokenDays} days`}
            width={labelWidth}
          />
        ) : null}
      </box>

      <TopTable
        columnWidth={columnWidth}
        leftEntries={summary.models}
        leftTitle="MODELS"
        leftTotal={summary.modelTotal}
        rightEntries={summary.branches}
        rightTitle="BRANCHES"
        rightTotal={summary.branchTotal}
      />
    </box>
  )
}
