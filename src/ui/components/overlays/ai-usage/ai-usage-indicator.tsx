import type { AIUsageTool } from '@brimveyn/aimux-config'

import { useAIUsageStore } from '../../../../state/ai-usage-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useBg, useTokens } from '../../../theme'

const TOOL_ICON: Record<AIUsageTool, string> = {
  claude: 'CC',
  codex: 'CO',
}

const BAR_SEGMENTS = 4
const BAR_FILLED_CHAR = '\u{2501}'
const BAR_EMPTY_CHAR = '\u{2500}'

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`
  return String(total)
}

function buildBar(percent: number): { empty: string; filled: string } {
  let filledCount = 0
  for (let i = 0; i < BAR_SEGMENTS; i++) {
    if (percent > i * (100 / BAR_SEGMENTS)) filledCount++
  }
  return {
    empty: BAR_EMPTY_CHAR.repeat(BAR_SEGMENTS - filledCount),
    filled: BAR_FILLED_CHAR.repeat(filledCount),
  }
}

function formatResetIn(snap: {
  resetAt: string | null
  timeRemaining: string | null
}): string | null {
  if (snap.resetAt) {
    const diffMs = new Date(snap.resetAt).getTime() - Date.now()
    if (diffMs > 0) {
      const totalMin = Math.round(diffMs / 60_000)
      const h = Math.floor(totalMin / 60)
      const m = totalMin % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}h`
    }
  }
  return snap.timeRemaining
}

export function AIUsageIndicator() {
  const t = useTokens()
  const bg = useBg('elevated')
  const enabled = useAIUsageStore((s) => s.enabled)
  const snapshots = useAIUsageStore((s) => s.snapshots)

  if (!enabled) return null

  const ordered: AIUsageTool[] = ['claude', 'codex']
  const entries = ordered
    .map((tool) => ({ snap: snapshots[tool], tool }))
    .filter((entry) => entry.snap !== undefined)

  const openModal = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault()
    e.stopPropagation()
    dispatchGlobal({ type: 'open-ai-usage-modal' })
  }

  if (entries.length === 0) {
    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={bg}
        onMouseDown={openModal}
      >
        <text fg={t.muted}>…</text>
      </box>
    )
  }

  return (
    <box flexDirection="row" gap={1}>
      {entries.map(({ snap, tool }) => {
        if (!snap) return null
        const icon = TOOL_ICON[tool]

        if (snap.error && !snap.stale) {
          return (
            <box
              key={tool}
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={bg}
              onMouseDown={openModal}
            >
              <text fg={t.palette.error} selectable={false}>
                {`${icon} —`}
              </text>
            </box>
          )
        }

        if (snap.percent !== null) {
          const p = Math.round(snap.percent)
          let color = t.palette.success
          if (p >= 85) {
            color = t.palette.error
          } else if (p >= 60) {
            color = t.palette.warning
          }
          const { empty, filled } = buildBar(snap.percent)
          const reset = formatResetIn(snap)
          const pctText = `${String(p).padStart(2, ' ')}%`
          return (
            <box
              key={tool}
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={bg}
              onMouseDown={openModal}
            >
              <text fg={color} selectable={false}>
                {`${icon} `}
              </text>
              <text fg={color} selectable={false}>
                {filled}
              </text>
              <text fg={t.muted} selectable={false}>
                {empty}
              </text>
              <text fg={t.palette.ink} selectable={false}>
                {` ${pctText}`}
              </text>
              {reset ? (
                <text fg={t.muted} selectable={false}>
                  {` · ${reset}`}
                </text>
              ) : null}
            </box>
          )
        }

        return (
          <box
            key={tool}
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={bg}
            onMouseDown={openModal}
          >
            <text fg={t.muted} selectable={false}>
              {`${icon} ${formatTokens(snap.tokens.total)}`}
            </text>
          </box>
        )
      })}
    </box>
  )
}
