import type { AIUsageTool } from '@brimveyn/aimux-config'

import { useCallback } from 'react'

import { useAIUsageStore } from '../../../../state/ai-usage-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { formatCompact } from '../../../format-number'
import { useTheme } from '../../../theme'

/** nf-cod-claude / nf-cod-openai. Needs a nerd font, like the status bar separators. */
const ICON: Record<AIUsageTool, string> = {
  claude: '\u{ec82}',
  codex: '\u{ec81}',
}

export function AIUsageIndicator() {
  const t = useTheme()
  const enabled = useAIUsageStore((s) => s.enabled)
  const snapshots = useAIUsageStore((s) => s.snapshots)

  const openQuotas = useCallback(
    (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      e.preventDefault()
      e.stopPropagation()
      dispatchGlobal({ type: 'open-quotas-modal' })
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
      <box flexDirection="row" onMouseDown={openQuotas}>
        <text fg={t.textMuted} selectable={false}>
          …
        </text>
      </box>
    )
  }

  return (
    <box flexDirection="row" gap={2} onMouseDown={openQuotas}>
      {entries.map(({ snap, tool }) => {
        if (!snap) return null

        if (snap.error != null && snap.error !== '' && !(snap.stale === true)) {
          return (
            <box key={tool} flexDirection="row">
              <text fg={t.text} selectable={false}>
                {ICON[tool]}
              </text>
            </box>
          )
        }

        const value =
          snap.percent !== null ? `${Math.round(snap.percent)}%` : formatCompact(snap.tokens.total)

        return (
          <box key={tool} flexDirection="row">
            <text fg={t.text} selectable={false}>
              {`${ICON[tool]} ${value}`}
            </text>
          </box>
        )
      })}
    </box>
  )
}
