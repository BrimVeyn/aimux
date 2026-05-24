import type { CliRenderer } from '@opentui/core'

export type GraphicsProtocol = 'kitty' | 'iterm' | 'none'

interface RendererWithCapabilities {
  capabilities?: { kitty_graphics?: boolean } | null
}

let cached: GraphicsProtocol | null = null

export function detectGraphicsProtocol(renderer: CliRenderer): GraphicsProtocol {
  if (cached !== null) return cached
  const caps = (renderer as RendererWithCapabilities).capabilities
  if (caps?.kitty_graphics === true) {
    cached = 'kitty'
    return cached
  }
  if (Bun.env.TERM_PROGRAM === 'iTerm.app') {
    cached = 'iterm'
    return cached
  }
  cached = 'none'
  return cached
}

export function isInsideTmux(): boolean {
  return Boolean(Bun.env.TMUX)
}

export function terminalLabel(): string {
  return Bun.env.TERM_PROGRAM ?? Bun.env.TERM ?? 'unknown terminal'
}
