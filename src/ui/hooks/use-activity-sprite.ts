import { useRenderer } from '@opentui/react'
import { useEffect, useState } from 'react'

import { useActivitySprites } from '../../settings/live'
import { detectGraphicsProtocol, isInsideTmux } from '../terminal-graphics/capabilities'
import {
  loadSprites,
  SPRITE_PLACEHOLDERS,
  type SpriteSet,
  type SpriteState,
} from '../terminal-graphics/sprites'

export interface ActivitySprite {
  /** The colour is the frame's image id — see `Sprite.colors`. */
  fg: string
  /** The cells to draw, one entry per line of the row, top line first. */
  glyphs: readonly string[]
}

const NO_SPRITES: SpriteSet = {}

function useFrame(intervalMs: number): number {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    // A tick count, not an index: consumers cycle over lists of different
    // lengths and take their own modulo, so wrapping here would make whichever
    // length does not divide the wrap jump backwards once per cycle.
    if (intervalMs <= 0) return
    const interval = setInterval(() => setFrame((prev) => prev + 1), intervalMs)
    return () => clearInterval(interval)
  }, [intervalMs])

  return frame
}

/**
 * The sprite standing in for a row's status marker, or null when the caller
 * should draw its own glyph — the toggle is off, the terminal cannot composite
 * images, or nothing in the sprite folder covers this state.
 *
 * tmux owns the grid and does not understand placeholder cells, so sprites are
 * off there even when the terminal underneath could draw them.
 */
export function useActivitySprite(state: SpriteState | null): ActivitySprite | null {
  const [sprites, setSprites] = useState<SpriteSet>(NO_SPRITES)
  const renderer = useRenderer()
  const enabled =
    useActivitySprites() && detectGraphicsProtocol(renderer) === 'kitty' && !isInsideTmux()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const loaded = await loadSprites()
      if (!cancelled) setSprites(loaded)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  // Gated on `enabled` here, not only at load time: the loaded set stays in
  // state when the toggle is switched off, and the toggle is a live setting.
  const sprite = !enabled || state === null ? undefined : sprites[state]
  const colors = sprite?.colors
  // A still sprite needs no timer, and neither does a row whose state has none.
  const frame = useFrame(colors === undefined || colors.length < 2 ? 0 : (sprite?.frameMs ?? 0))

  const fg = colors?.[frame % colors.length]
  if (fg === undefined) return null
  return { fg, glyphs: SPRITE_PLACEHOLDERS }
}
