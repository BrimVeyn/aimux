// Kitty graphics protocol — pixel placement (a=p) with quiet, cursor-preserving
// placements. The image is uploaded once (a=t) with `f=100` (PNG), then placed
// at the cursor's current position.
// Spec: https://sw.kovidgoyal.net/kitty/graphics-protocol/

import { isInsideTmux } from './capabilities'

const ESC = '\x1b'
const ST = `${ESC}\\`
const MAX_BASE64_CHUNK = 4096

// Image IDs use the 24-bit RGB foreground color of placeholder cells. We start
// from 0x100000 to avoid collisions with embedded PTYs that may also emit
// graphics commands (Kitty namespaces images per-window but the spec is loose).
let nextId = 0x100000

export function nextImageId(): number {
  const id = nextId++
  // Wrap at 24-bit; we don't expect to leak more than ~16M IDs per project but
  // be safe in case of a long-running daemon.
  if (nextId > 0xffffff) nextId = 0x100000
  return id
}

function idToRgb(id: number): [number, number, number] {
  return [(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]
}

function wrapForTmux(seq: string): string {
  if (!isInsideTmux()) return seq
  // tmux passthrough: wrap in DCS tmux; ... ST, and double every ESC inside.
  return `${ESC}Ptmux;${seq.split(ESC).join(`${ESC}${ESC}`)}${ESC}\\`
}

function encodeBase64(bytes: Uint8Array): string {
  // Bun supports btoa for binary strings, but Buffer is faster for large blobs.
  return Buffer.from(bytes).toString('base64')
}

function chunkString(s: string, size: number): string[] {
  if (s.length <= size) return [s]
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

// Build the upload escape(s) for a PNG (f=100) image. Chunked per Kitty spec
// recommendation (≤ 4096 base64 bytes per escape).
//
// The upload is preceded by a delete of the same id. Images outlive the
// process — they belong to the terminal window — and this process allocates
// ids from a fixed base, so a previous run may have left this very id carrying
// a *different* placement. An image with two virtual placements and nothing to
// disambiguate them draws at whichever size the terminal happens to pick.
export function uploadPngEscape(pngBytes: Uint8Array, id: number): string {
  const b64 = encodeBase64(pngBytes)
  const chunks = chunkString(b64, MAX_BASE64_CHUNK)
  const parts: string[] = [`${ESC}_Ga=d,d=I,i=${id},q=2;${ST}`]
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    const m = isLast ? 0 : 1
    // a=t (transmit), t=d (direct), f=100 (PNG), q=2 (quiet).
    const header = i === 0 ? `q=2,a=t,t=d,f=100,i=${id},m=${m}` : `m=${m},q=2`
    parts.push(`${ESC}_G${header};${chunks[i]}${ST}`)
  }
  return wrapForTmux(parts.join(''))
}

// A virtual placement (U=1) is not painted over the screen: the terminal
// composites the image into whichever cells carry the Unicode placeholder,
// which is what lets an image survive redraws the app makes on its own. `cols`
// and `rows` size the placeholder box, and the image is scaled to fill it.
//
// Deliberately no source rectangle (`x`/`y`/`w`/`h`): terminals that speak the
// rest of this protocol do not all honour it on a virtual placement, and one
// that ignores it silently draws the whole image instead of the slice asked
// for. Callers upload one image per frame.
export function virtualPlacementEscape(id: number, cols: number, rows: number): string {
  return wrapForTmux(`${ESC}_Ga=p,U=1,i=${id},c=${cols},r=${rows},q=2;${ST}`)
}

export function deleteImageEscape(id: number): string {
  return wrapForTmux(`${ESC}_Ga=d,d=I,i=${id},q=2;${ST}`)
}

export function imageIdToRgb(id: number): [number, number, number] {
  return idToRgb(id)
}

// Same id, spelled the way a renderable's `fg` wants it. The colour is not a
// colour here: it is what tells the terminal which image a placeholder cell
// stands for, so it has to survive the round trip through the renderer intact.
export function imageIdToHex(id: number): string {
  return `#${(id & 0xffffff).toString(16).padStart(6, '0')}`
}

export function writeRaw(seq: string): void {
  // Synchronous write so we don't interleave with opentui frames.
  process.stdout.write(seq)
}
