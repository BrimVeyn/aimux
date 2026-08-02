// Activity sprites: a small animation per agent state, drawn where the sidebar
// would otherwise put a spinner or a dot.
//
// Every frame is its own image, uploaded once and given a virtual placement, so
// animating is nothing but changing the foreground colour of two cells — no
// escape written per frame, and nothing an opentui redraw can wipe. One image
// per frame rather than one sheet cropped per placement: the source rectangle
// of a placement is not honoured by every terminal that speaks the protocol,
// and a sheet placed without it draws all its frames at once.
//
// Naming carries everything, so there is no manifest to keep in step with the
// files. Either form works:
//   - a folder `<state>@<ms>/` of numbered PNGs, one per frame (`0.png`, `1.png`…)
//   - a `<state>.gif`, which brings its own frames and delay, cut by ImageMagick

import { readdir } from 'node:fs/promises'

import { logDebug } from '../../debug/input-log'
import { getProfileConfigDir } from '../../profile-paths'
import {
  imageIdToHex,
  nextImageId,
  uploadPngEscape,
  virtualPlacementEscape,
  writeRaw,
} from './kitty'

export const SPRITE_STATES = ['idle', 'working', 'waiting', 'done'] as const

export type SpriteState = (typeof SPRITE_STATES)[number]

export type SpriteSet = Partial<Record<SpriteState, Sprite>>

export interface Sprite {
  /**
   * One entry per frame. Not a colour: it is the 24-bit id of the image the
   * placeholder cells stand for, spelled the way a renderable's `fg` wants it.
   */
  colors: readonly string[]
  frameMs: number
}

/**
 * The one shape a sprite is ever placed into: the two lines of a workspace row,
 * three cells across.
 *
 * Deliberately the only one. A frame gets a single image and a single placement,
 * so a cell cannot resolve to a box other than the one it was drawn for. Earlier
 * revisions placed each frame at several sizes for the different rows that
 * wanted them, and sprites drew at the wrong size — three placements of visually
 * identical images stacked in one column is a resolution the protocol gives no
 * way to make unambiguous from a cell alone.
 *
 * Three cells across because the terminal fits an image to its box keeping the
 * aspect ratio: for a roughly square frame in cells twice as tall as they are
 * wide, the width is what caps the sprite, and two rows of height buy nothing
 * under two cells of width.
 */
export const SPRITE_COLS = 3
const SPRITE_ROWS = 2

// Kitty encodes a placeholder cell's row and column as combining marks, the Nth
// entry of the spec's table standing for N. Three of each is all this needs.
const MARKS = ['̅', '̍', '̎'] as const
const DEFAULT_FRAME_MS = 150
const BUNDLED_DIR = `${import.meta.dir}/sprites`
const FOLDER_NAME = /^(idle|working|waiting|done)@(\d+)$/
const GIF_NAME = /^(idle|working|waiting|done)\.gif$/
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** U+10EEEE, the Kitty placeholder. */
const PLACEHOLDER = '\u{10EEEE}'

/**
 * The cells of a sprite, one string per line of its box, top line first.
 *
 * Every cell names the row and the column it stands for, always — never a bare
 * placeholder left for the terminal to work out. Its rule for an unmarked cell
 * looks up as well as left: a placeholder sitting directly below another of the
 * same image reads as the next row down. A sidebar is a column of rows drawing
 * the same idle sprite, so each one would inherit the position of the row above
 * it and draw a slice of the image rather than the image.
 *
 * The marks are zero-width, so a line is exactly `SPRITE_COLS` columns wide.
 */
function placeholderLines(): string[] {
  return Array.from({ length: SPRITE_ROWS }, (_, row) => {
    const rowMark = MARKS[row] ?? MARKS[0]
    let line = ''
    for (let col = 0; col < SPRITE_COLS; col++) {
      line += `${PLACEHOLDER}${rowMark}${MARKS[col] ?? MARKS[0]}`
    }
    return line
  })
}

/** Resolved once: the same two strings every row of the sidebar draws. */
export const SPRITE_PLACEHOLDERS: readonly string[] = placeholderLines()

/** Where a user drops their own sprites. Anything here beats what aimux ships. */
export function userSpriteDir(): string {
  return `${getProfileConfigDir()}/sprites`
}

export interface SpriteName {
  frameMs: number
  /** True when the frames come from a GIF and only ImageMagick can read them. */
  gif: boolean
  state: SpriteState
}

/**
 * What an entry in a sprite folder declares, or null when it declares nothing —
 * the folder is the user's, and a stray screenshot in it is not a configuration
 * error.
 */
export function parseSpriteName(entry: string): SpriteName | null {
  const folder = FOLDER_NAME.exec(entry)
  if (folder) {
    const ms = Number.parseInt(folder[2] ?? '', 10)
    return {
      frameMs: Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_FRAME_MS,
      gif: false,
      state: folder[1] as SpriteState,
    }
  }
  const gif = GIF_NAME.exec(entry)
  if (gif === null) return null
  return { frameMs: DEFAULT_FRAME_MS, gif: true, state: gif[1] as SpriteState }
}

interface Frames {
  frameMs: number
  pngs: Uint8Array[]
}

async function runMagick(args: string[], timeoutMs: number): Promise<Uint8Array | null> {
  for (const bin of ['magick', 'convert']) {
    try {
      const proc = Bun.spawn([bin, ...args], { stderr: 'ignore', stdin: 'ignore', stdout: 'pipe' })
      const timer = setTimeout(() => proc.kill(), timeoutMs)
      const [out, code] = await Promise.all([new Response(proc.stdout).bytes(), proc.exited])
      clearTimeout(timer)
      if (code === 0 && out.byteLength > 0) return out
    } catch {
      // Next binary, then give up: a missing ImageMagick is not an error, it
      // only means GIF sprites are unavailable.
    }
  }
  return null
}

/**
 * ImageMagick writes one PNG per frame back to back on stdout. They are split on
 * the signature rather than counted, so a frame count that disagrees with the
 * stream cannot desynchronise the two.
 */
function splitPngs(bytes: Uint8Array): Uint8Array[] {
  const starts: number[] = []
  for (let i = 0; i + PNG_SIGNATURE.length <= bytes.length; i++) {
    if (PNG_SIGNATURE.every((byte, k) => bytes[i + k] === byte)) starts.push(i)
  }
  return starts.map((start, i) => bytes.subarray(start, starts[i + 1] ?? bytes.length))
}

/** A GIF's own frame count and delay are authoritative, so it names neither. */
async function gifFrames(path: string): Promise<Frames | null> {
  const pngs = splitPngs((await runMagick([path, '-coalesce', 'png:-'], 5000)) ?? new Uint8Array())
  if (pngs.length === 0) return null
  const meta = await runMagick(['identify', '-format', '%T\\n', path], 2000)
  const ticks = Number.parseInt(new TextDecoder().decode(meta ?? new Uint8Array()), 10)
  // GIF delays are in hundredths of a second, and 0 is the "as fast as you can"
  // some encoders write — which at this size would be a strobe.
  const frameMs = Number.isFinite(ticks) && ticks > 0 ? ticks * 10 : DEFAULT_FRAME_MS
  return { frameMs, pngs }
}

/** Frames in numeric order — `10.png` follows `9.png`, it does not precede it. */
async function folderFrames(dir: string, frameMs: number): Promise<Frames | null> {
  const files = (await readdir(dir))
    .filter((file) => file.endsWith('.png'))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  if (files.length === 0) return null
  return {
    frameMs,
    pngs: await Promise.all(files.map(async (file) => Bun.file(`${dir}/${file}`).bytes())),
  }
}

/** Every sprite a directory declares, keyed by the state it stands for. */
async function scanDir(dir: string): Promise<Map<SpriteState, Frames>> {
  const found = new Map<SpriteState, Frames>()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return found
  }

  for (const entry of entries.sort()) {
    const name = parseSpriteName(entry)
    if (name === null) continue
    const frames = name.gif
      ? await gifFrames(`${dir}/${entry}`)
      : await folderFrames(`${dir}/${entry}`, name.frameMs)
    if (frames) found.set(name.state, frames)
    else if (name.gif) {
      logDebug('sprites.gif.failed', { entry, reason: 'ImageMagick unavailable or failed' })
    }
  }
  return found
}

function upload(frames: Frames): Sprite {
  const colors = frames.pngs.map((png) => {
    const id = nextImageId()
    writeRaw(uploadPngEscape(png, id) + virtualPlacementEscape(id, SPRITE_COLS, SPRITE_ROWS))
    return imageIdToHex(id)
  })
  return { colors, frameMs: Math.max(16, frames.frameMs) }
}

async function loadAll(): Promise<SpriteSet> {
  // The user's folder is scanned second so a state it declares replaces the one
  // aimux ships, rather than being merged with it.
  const found = new Map([...(await scanDir(BUNDLED_DIR)), ...(await scanDir(userSpriteDir()))])
  const set: SpriteSet = {}
  for (const [state, frames] of found) set[state] = upload(frames)
  return set
}

let loaded: Promise<SpriteSet> | null = null

/**
 * Uploaded once per process — every row animates off the same images. Read from
 * disk at first use, so a sprite dropped into the folder appears at the next
 * launch, not mid-session.
 */
export async function loadSprites(): Promise<SpriteSet> {
  loaded ??= loadAll()
  try {
    return await loaded
  } catch {
    return {}
  }
}
