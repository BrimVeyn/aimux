import type { AIUsageTool, ResolvedTuiTheme } from '@brimveyn/aimux-config'

import { useCallback } from 'react'

import { useAIUsageStore } from '../../../../state/ai-usage-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'

/** nf-cod-claude / nf-cod-openai. Needs a nerd font, like the status bar separators. */
const ICON: Record<AIUsageTool, string> = {
  claude: '\u{ec82}',
  codex: '\u{ec81}',
}

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`
  return String(total)
}

function pickPercentColor(t: ResolvedTuiTheme, percent: number): string {
  if (percent >= 85) return t.error
  if (percent >= 60) return t.warning
  return t.success
}

export function AIUsageIndicator() {
  const t = useTheme()
  const enabled = useAIUsageStore((s) => s.enabled)
  const snapshots = useAIUsageStore((s) => s.snapshots)

  const openModal = useCallback(
    (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      e.preventDefault()
      e.stopPropagation()
      dispatchGlobal({ type: 'open-ai-usage-modal' })
    },
    []
  )

  if (!enabled) return null

  const ordered: AIUsageTool[] = ['claude', 'codex']
  const entries = ordered
    .map((tool) => ({ snap: snapshots[tool], tool }))
    .filter((entry) => entry.snap !== undefined)

  if (entries.length === 0) {
    return (
      <box flexDirection="row" onMouseDown={openModal}>
        <text fg={t.textMuted} selectable={false}>
          …
        </text>
      </box>
    )
  }

  return (
    <box flexDirection="row" gap={2} onMouseDown={openModal}>
      {entries.map(({ snap, tool }) => {
        if (!snap) return null

        if (snap.error != null && snap.error !== '' && !(snap.stale === true)) {
          return (
            <box key={tool} flexDirection="row">
              <text fg={t.error} selectable={false}>
                {ICON[tool]}
              </text>
            </box>
          )
        }

        if (snap.percent !== null) {
          const p = Math.round(snap.percent)
          const color = pickPercentColor(t, snap.percent)
          return (
            <box key={tool} flexDirection="row">
              <text fg={t.text} selectable={false}>
                {ICON[tool]}
              </text>
              <text fg={color} selectable={false}>
                {` ${p}%`}
              </text>
            </box>
          )
        }

        return (
          <box key={tool} flexDirection="row">
            <text fg={t.textMuted} selectable={false}>
              {ICON[tool]}
            </text>
            <text fg={t.textMuted} selectable={false}>
              {` ${formatTokens(snap.tokens.total)}`}
            </text>
          </box>
        )
      })}
    </box>
  )
}
