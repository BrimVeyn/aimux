import type { PluginSessionInfo, PluginSessionUsage } from '@brimveyn/aimux-plugin'

/** What the daemon half sends, per tab, and what the UI half keeps. */
export interface TabUsage {
  session: PluginSessionInfo
  usage: PluginSessionUsage
}

/** `1234` → `1.2k`, `12345678` → `12.3M`. Three glyphs of precision is what a tile has room for. */
export function tokens(n: number): string {
  if (n < 1_000) return `${n}`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** `claude-opus-4-1-20250805` → `opus`. The tile shows the family, the page shows the id. */
export function family(model: string | null): string {
  if (model === null) return '—'
  const match = /(haiku|sonnet|opus|fable|mythos|o\d|gpt-[\w.]+)/i.exec(model)
  return match?.[1] === undefined ? model : match[1].toLowerCase()
}
