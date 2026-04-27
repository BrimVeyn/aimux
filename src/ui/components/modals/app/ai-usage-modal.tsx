import type { AIUsageTool } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import type {
  UsagePaceStage,
  UsageSnapshot,
  UsageWindow,
} from '../../../../services/ai-usage/types'

import { useAIUsageStore } from '../../../../state/ai-usage-store'
import { useTheme } from '../../../theme'
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

export function AIUsageModal() {
  const t = useTheme()
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
        <text fg={t.textMuted} selectable={false}>
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
  const t = useTheme()
  const isHardError = Boolean(snap.error) && !snap.stale
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
        {snap.planTier ? (
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
  const resetText = window.timeRemaining ? `Resets in ${window.timeRemaining}` : null

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
        {resetText ? (
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

  const suffix = pace.rightText ? ` · ${pace.rightText}` : ''
  return (
    <text fg={color} selectable={false}>
      {`Pace: ${pace.label}${suffix}`}
    </text>
  )
}
