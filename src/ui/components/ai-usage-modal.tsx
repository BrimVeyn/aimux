import type { AIUsageTool } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import type { UsagePaceStage, UsageSnapshot, UsageWindow } from '../../services/ai-usage/types'

import { useAIUsageStore } from '../../state/ai-usage-store'
import { useTokens } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ModalShell } from './modal-shell'

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

export function AIUsageModal() {
  const t = useTokens()
  const snapshots = useAIUsageStore((s) => s.snapshots)

  const tools: AIUsageTool[] = ['claude', 'codex']
  const sections = tools
    .map((tool) => ({ snap: snapshots[tool], tool }))
    .filter((s): s is { snap: UsageSnapshot; tool: AIUsageTool } => s.snap !== undefined)

  return (
    <ModalShell
      title="AI usage"
      keybindsModeId="modal.ai-usage"
      width={uiTokens.modalWidth.md}
      listGap={1}
    >
      {sections.length === 0 ? (
        <text fg={t.muted} selectable={false}>
          no data yet — collecting…
        </text>
      ) : (
        <box flexDirection="column" gap={1}>
          {sections.map(({ snap, tool }) => (
            <ToolSection key={tool} snap={snap} tool={tool} />
          ))}
        </box>
      )}
    </ModalShell>
  )
}

interface ToolSectionProps {
  snap: UsageSnapshot
  tool: AIUsageTool
}

function ToolSection({ snap, tool }: ToolSectionProps) {
  const t = useTokens()
  const isHardError = Boolean(snap.error) && !snap.stale
  const relative = formatRelative(snap.lastUpdated)

  let body: ReactNode
  if (isHardError) {
    body = (
      <text fg={t.palette.error} selectable={false}>
        {`error: ${snap.error ?? ''}`}
      </text>
    )
  } else if (snap.windows.length === 0) {
    body = (
      <text fg={t.muted} selectable={false}>
        no window data
      </text>
    )
  } else {
    body = snap.windows.map((window) => <WindowRow key={window.kind} window={window} />)
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={t.accent} selectable={false}>
          {TOOL_TITLE[tool]}
        </text>
        {snap.planTier ? (
          <text fg={t.muted} selectable={false}>
            {snap.planTier}
          </text>
        ) : null}
      </box>
      <text fg={t.muted} selectable={false}>
        {`Updated ${relative}`}
      </text>
      {body}
    </box>
  )
}

function WindowRow({ window }: { window: UsageWindow }) {
  const t = useTokens()
  const percent = window.percent
  const { empty, filled } = buildBar(percent)

  let barColor = t.palette.success
  if (percent !== null) {
    if (percent >= 85) barColor = t.palette.error
    else if (percent >= 60) barColor = t.palette.warning
  }

  const pctText = percent === null ? '—' : `${Math.round(percent)}% used`
  const resetText = window.timeRemaining ? `Resets in ${window.timeRemaining}` : null

  return (
    <box flexDirection="column" paddingTop={1}>
      <text fg={t.palette.ink} selectable={false}>
        {window.label}
      </text>
      <box flexDirection="row">
        <text fg={barColor} selectable={false}>
          {filled}
        </text>
        <text fg={t.muted} selectable={false}>
          {empty}
        </text>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={t.muted} selectable={false}>
          {pctText}
        </text>
        {resetText ? (
          <text fg={t.muted} selectable={false}>
            {resetText}
          </text>
        ) : null}
      </box>
      {window.pace ? <PaceLine pace={window.pace} /> : null}
    </box>
  )
}

function PaceLine({ pace }: { pace: NonNullable<UsageWindow['pace']> }) {
  const t = useTokens()
  let color = t.muted
  if (paceStageIsBehind(pace.stage)) color = t.palette.warning
  else if (paceStageIsAhead(pace.stage)) color = t.palette.success

  const suffix = pace.rightText ? ` · ${pace.rightText}` : ''
  return (
    <text fg={color} selectable={false}>
      {`Pace: ${pace.label}${suffix}`}
    </text>
  )
}
