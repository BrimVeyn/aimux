#!/usr/bin/env bun
// Draws the activity sprites with raw escapes, no opentui in the way, so a
// rendering problem can be pinned on the protocol or on the app rather than
// guessed at. Every frame of every state, side by side.
//
//   bun scripts/sprite-probe.ts

import {
  loadSprites,
  SPRITE_PLACEHOLDERS,
  SPRITE_STATES,
} from '../src/ui/terminal-graphics/sprites'

function sgr(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `\x1b[38;2;${(n >> 16) & 0xff};${(n >> 8) & 0xff};${n & 0xff}m`
}

const sprites = await loadSprites()
const states = SPRITE_STATES.filter((state) => sprites[state] !== undefined)
if (states.length === 0) {
  process.stdout.write('No sprites loaded — nothing in the bundled folder parsed.\n')
  process.exit(1)
}

for (const state of states) {
  const colors = sprites[state]?.colors ?? []
  process.stdout.write(`\n\x1b[1m${state}\x1b[0m — ${String(colors.length)} frames\n`)
  for (const [row, line] of SPRITE_PLACEHOLDERS.entries()) {
    process.stdout.write(row === 0 ? '  ' : '  ')
    for (const color of colors) process.stdout.write(`${sgr(color)}${line}\x1b[39m `)
    process.stdout.write('\n')
  }
}
process.stdout.write('\n')
