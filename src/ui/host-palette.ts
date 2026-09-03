import { getBaseTheme, getCurrentTheme, getTransparent } from './theme'

// Resolves ANSI palette indices (0-255) to hex strings using the host
// terminal's actual palette, queried via OSC 4 at startup (see index.tsx).
//
// Before detection completes — or when the host terminal doesn't respond —
// FALLBACK_PALETTE (xterm defaults) is used. Indices ≥16 fall back to the
// universal 6×6×6 cube + grayscale ramp, which every terminal agrees on.

const FALLBACK_PALETTE: readonly string[] = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
  '#7f7f7f',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#5c5cff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
]

const CUBE_CHANNELS = [0, 95, 135, 175, 215, 255] as const

const hostPalette: string[] = [...FALLBACK_PALETTE]

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

function paletteFromFormula(index: number): string {
  if (index >= 232) {
    const shade = 8 + (index - 232) * 10
    return toHex((shade << 16) | (shade << 8) | shade)
  }

  const normalized = index - 16
  const r = Math.floor(normalized / 36)
  const g = Math.floor((normalized % 36) / 6)
  const b = normalized % 6
  return toHex(
    ((CUBE_CHANNELS[r] ?? 0) << 16) | ((CUBE_CHANNELS[g] ?? 0) << 8) | (CUBE_CHANNELS[b] ?? 0)
  )
}

/** Replace entries 0..N-1 of the resolver with values queried from the host
 *  terminal. Null entries keep the existing fallback (terminal didn't respond
 *  for that index). Safe to call before any snapshots have been rendered. */
export function setHostPalette(palette: readonly (string | null)[]): void {
  for (let index = 0; index < palette.length; index += 1) {
    const value = palette[index]
    if (typeof value === 'string' && value.length > 0) {
      hostPalette[index] = value
    }
  }
}

/** Resolve an ANSI palette index (0-255) to a hex color. Indices 0-15 use
 *  the host-queried palette (or xterm fallback); 16-255 use the universal
 *  cube/grayscale formula unless the host explicitly customized them. */
const BLACK = '#000000'
const WHITE = '#ffffff'

export function resolvePaletteIndex(index: number): string {
  if (index < 0) return BLACK
  const override = hostPalette[index]
  if (typeof override === 'string' && override.length > 0) return override
  if (index < 16) return FALLBACK_PALETTE.at(index) ?? BLACK
  if (index > 255) return WHITE
  return paletteFromFormula(index)
}

// The default fg/bg/cursor the host terminal reported alongside its palette
// (OSC 10/11/12, answered by the same `getPalette()` probe as OSC 4). Empty
// until detection completes, and on terminals that answer the palette but not
// these.
const hostSpecials: { background?: string; cursor?: string; foreground?: string } = {}

function isHex(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export function setHostSpecialColors(colors: {
  defaultBackground?: string | null
  defaultForeground?: string | null
  cursorColor?: string | null
}): void {
  if (isHex(colors.defaultBackground)) hostSpecials.background = colors.defaultBackground
  if (isHex(colors.defaultForeground)) hostSpecials.foreground = colors.defaultForeground
  if (isHex(colors.cursorColor)) hostSpecials.cursor = colors.cursorColor
}

/**
 * What a PTY child should be told when it asks the terminal for its colours.
 *
 * Programs that probe (OSC 10/11/12/4) use the answer to decide whether to
 * paint their own surface: opencode paints an opaque near-black background
 * when nothing answers, and leaves the surface unpainted when something does —
 * which is the difference between a pane that swallows the host terminal and
 * one that shows through it.
 *
 * The answer is what the pane actually shows: in transparent mode the host
 * terminal's own colours, otherwise the aimux theme. Serialised here rather
 * than sent as structured IPC because it rides to the PTY process on the env
 * that `createTab` already carries — see `AIMUX_TERM_COLORS` in pty-manager.
 */
export function serializeTerminalColors(): string {
  const theme = getCurrentTheme()
  const transparent = getTransparent()
  // Any answer beats none — silence is what makes a child paint — so when the
  // host never answered the probe, transparent mode still reports the theme.
  const bg = transparent ? hostSpecials.background : undefined
  const fg = transparent ? hostSpecials.foreground : undefined
  return JSON.stringify({
    bg: bg ?? getBaseTheme().background,
    cursor: hostSpecials.cursor,
    fg: fg ?? theme.text,
    palette: hostPalette.slice(0, 16),
  })
}
