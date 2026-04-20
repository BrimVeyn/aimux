import type { AIUsageTool } from '@brimveyn/aimux-config'

import { useAIUsageStore } from '../../state/ai-usage-store'
import { toggleAIUsagePopover } from '../ai-usage/controller'
import { useTokens } from '../theme'

const TOOL_ICON: Record<AIUsageTool, string> = {
  claude: '\u{f0a5c}',
  codex: '\u{f05c6}',
}

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`
  return String(total)
}

export function AIUsageIndicator() {
  const t = useTokens()
  const enabled = useAIUsageStore((s) => s.enabled)
  const snapshots = useAIUsageStore((s) => s.snapshots)

  if (!enabled) return null

  const ordered: AIUsageTool[] = ['claude', 'codex']
  const entries = ordered
    .map((tool) => ({ snap: snapshots[tool], tool }))
    .filter((entry) => entry.snap !== undefined)

  if (entries.length === 0) {
    return (
      <box flexDirection="row" gap={1}>
        <text fg={t.muted}>AI —</text>
      </box>
    )
  }

  return (
    <box
      flexDirection="row"
      gap={1}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.button !== 0) return
        toggleAIUsagePopover(e.x, e.y)
      }}
    >
      {entries.map(({ snap, tool }) => {
        if (!snap) return null
        const icon = TOOL_ICON[tool]
        if (snap.error) {
          return (
            <text key={tool} fg={t.palette.error} selectable={false}>
              {icon} —
            </text>
          )
        }
        if (snap.percent !== null) {
          const p = Math.round(snap.percent)
          let color = t.muted
          if (p >= 85) {
            color = t.palette.error
          } else if (p >= 60) {
            color = t.palette.warning
          }
          return (
            <text key={tool} fg={color} selectable={false}>
              {icon} {p}%
            </text>
          )
        }
        return (
          <text key={tool} fg={t.muted} selectable={false}>
            {icon} {formatTokens(snap.tokens.total)}
          </text>
        )
      })}
    </box>
  )
}
