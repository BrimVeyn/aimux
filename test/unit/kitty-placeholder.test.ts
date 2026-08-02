import { expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

import {
  imageIdToHex,
  imageIdToRgb,
  uploadPngEscape,
  virtualPlacementEscape,
} from '../../src/ui/terminal-graphics/kitty'
import {
  parseSpriteName,
  SPRITE_COLS,
  SPRITE_PLACEHOLDERS,
  SPRITE_STATES,
} from '../../src/ui/terminal-graphics/sprites'

const BUNDLED = `${import.meta.dir}/../../src/ui/terminal-graphics/sprites`

test('a virtual placement names its image and the cell box it fills', () => {
  expect(virtualPlacementEscape(0x100001, 2, 1)).toBe('\x1b_Ga=p,U=1,i=1048577,c=2,r=1,q=2;\x1b\\')
})

test('an upload deletes its id before transmitting', () => {
  // Images belong to the terminal window, not the process, and ids restart from
  // a fixed base every launch — without the delete, a placement left by an
  // earlier run shares the id and the sprite draws at whichever size the
  // terminal picks between the two.
  const esc = uploadPngEscape(new Uint8Array([1, 2, 3]), 0x100001)
  expect(esc.startsWith('\x1b_Ga=d,d=I,i=1048577,q=2;\x1b\\')).toBe(true)
})

test('every cell of every line names its own row and column', () => {
  // Nothing may be left to the terminal to infer. Its rule for an unmarked cell
  // looks upwards as well as leftwards, so in a column of rows all drawing the
  // same sprite each row would take its position from the row above and draw a
  // slice of the image instead of the image.
  expect(SPRITE_PLACEHOLDERS).toHaveLength(2)
  for (const [row, line] of SPRITE_PLACEHOLDERS.entries()) {
    const cells = line.split('\u{10EEEE}').slice(1)
    expect(cells, `line ${String(row)} is not ${String(SPRITE_COLS)} cells`).toHaveLength(
      SPRITE_COLS
    )
    for (const [col, marks] of cells.entries()) {
      expect(marks, `cell ${String(row)},${String(col)} is unmarked`).toHaveLength(2)
    }
  }
  // And the two lines must differ, or both draw the same half of the image.
  expect(SPRITE_PLACEHOLDERS[0]).not.toBe(SPRITE_PLACEHOLDERS[1])
})

test('an image id survives the trip through a foreground colour', () => {
  // The colour is the id: a component off by one addresses an image that was
  // never uploaded, and the cell draws nothing at all.
  for (const id of [0x100000, 0x10ff01, 0xffffff]) {
    const [r, g, b] = imageIdToRgb(id)
    expect(imageIdToHex(id)).toBe(`#${id.toString(16)}`)
    expect((r << 16) | (g << 8) | b).toBe(id)
  }
})

test('a sprite entry declares its state and its speed', () => {
  expect(parseSpriteName('working@150')).toEqual({ frameMs: 150, gif: false, state: 'working' })
  // A GIF carries its own delay, so it names only the state.
  expect(parseSpriteName('waiting.gif')).toEqual({ frameMs: 150, gif: true, state: 'waiting' })
  expect(parseSpriteName('idle')).toBeNull()
  expect(parseSpriteName('sleeping@500')).toBeNull()
  expect(parseSpriteName('screenshot.png')).toBeNull()
})

test('every bundled sprite is named the way the loader reads names', async () => {
  // The state and the frame duration live in the folder name and nowhere else,
  // so a typo there is a sprite that silently never appears.
  const entries = await readdir(BUNDLED)
  expect(entries.length).toBeGreaterThan(0)
  for (const entry of entries) {
    const name = parseSpriteName(entry)
    if (name === null) throw new Error(`${entry} is not a name the loader reads`)
    expect(SPRITE_STATES).toContain(name.state)
    // Frames are their own files: a folder of none is a state that draws
    // nothing at all, with no error anywhere to say why.
    const frames = (await readdir(`${BUNDLED}/${entry}`)).filter((f) => f.endsWith('.png'))
    expect(frames.length, `${entry} has no frames`).toBeGreaterThan(0)
  }
})
