import type { AIUsageTool } from '@brimveyn/aimux-config'

import { useKeyboard } from '@opentui/react'
import { useEffect, useState } from 'react'

import type { UsageSnapshot } from '../../services/ai-usage/types'

import { useAIUsageStore } from '../../state/ai-usage-store'
import { useAppStore } from '../../state/app-store'
import {
  type AIUsagePopoverState,
  closeAIUsagePopover,
  subscribeAIUsagePopover,
} from '../ai-usage/controller'
import { useTokens } from '../theme'

const TOOL_TITLE: Record<AIUsageTool, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

const POPOVER_WIDTH = 38

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function buildLines(snap: UsageSnapshot): string[] {
  if (snap.error && !snap.stale) {
    return [`error: ${snap.error.slice(0, 30)}`]
  }
  const lines: string[] = []
  if (snap.percent !== null) {
    lines.push(`usage   ${snap.percent.toFixed(1)}%`)
  }
  lines.push(`tokens  in ${fmt(snap.tokens.input)} / out ${fmt(snap.tokens.output)}`)
  if (snap.tokens.cache > 0) {
    lines.push(`cache   ${fmt(snap.tokens.cache)}`)
  }
  lines.push(`total   ${fmt(snap.tokens.total)}`)
  if (snap.costUSD !== null) {
    lines.push(`cost    $${snap.costUSD.toFixed(2)}`)
  }
  if (snap.burnRatePerHour !== null) {
    lines.push(`burn    ${fmt(Math.round(snap.burnRatePerHour))}/h`)
  }
  if (snap.timeRemaining) {
    lines.push(`resets  ${snap.timeRemaining}`)
  } else if (snap.resetAt) {
    lines.push(`resets  ${new Date(snap.resetAt).toLocaleTimeString()}`)
  }
  return lines
}

export function AIUsagePopover() {
  const [popover, setPopover] = useState<AIUsagePopoverState | null>(null)
  const t = useTokens()
  const enabled = useAIUsageStore((s) => s.enabled)
  const snapshots = useAIUsageStore((s) => s.snapshots)
  const terminalCols = useAppStore((s) => s.layout.terminalCols)
  const terminalRows = useAppStore((s) => s.layout.terminalRows)

  useEffect(() => subscribeAIUsagePopover(setPopover), [])

  useKeyboard((key) => {
    if (!popover) return
    if (key.name === 'escape') {
      key.preventDefault()
      closeAIUsagePopover()
    }
  })

  if (!enabled || !popover) return null

  const tools: AIUsageTool[] = ['claude', 'codex']
  const sections = tools
    .map((tool) => ({ snap: snapshots[tool], tool }))
    .filter((s) => s.snap !== undefined)

  let bodyLines = 0
  if (sections.length === 0) {
    bodyLines = 1
  } else {
    for (const s of sections) {
      if (!s.snap) continue
      bodyLines += buildLines(s.snap).length + 2
    }
  }
  const height = Math.min(terminalRows - 2, bodyLines + 2)
  const width = Math.min(terminalCols - 2, POPOVER_WIDTH)

  const left = Math.max(0, Math.min(popover.anchorX - width + 2, terminalCols - width))
  const top = Math.max(0, popover.anchorY - height)

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%">
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          closeAIUsagePopover()
        }}
      />
      <box
        position="absolute"
        top={top}
        left={left}
        width={width}
        flexDirection="column"
        border
        borderColor={t.palette.primary}
        backgroundColor={t.elevated}
        onMouseDown={(e) => {
          e.stopPropagation()
        }}
      >
        {sections.length === 0 ? (
          <box paddingLeft={1} paddingRight={1}>
            <text fg={t.muted} selectable={false}>
              no data yet — collecting…
            </text>
          </box>
        ) : (
          sections.map(({ snap, tool }, idx) => {
            if (!snap) return null
            const lines = buildLines(snap)
            return (
              <box key={tool} flexDirection="column" paddingLeft={1} paddingRight={1}>
                {idx > 0 ? <text fg={t.muted}> </text> : null}
                <text fg={t.accent} selectable={false}>
                  {TOOL_TITLE[tool]}
                </text>
                {lines.map((line, i) => (
                  <text key={`${tool}-${i}`} fg={t.palette.ink} selectable={false}>
                    {line}
                  </text>
                ))}
              </box>
            )
          })
        )}
      </box>
    </box>
  )
}
