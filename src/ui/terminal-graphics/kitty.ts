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
  // Wrap at 24-bit; we don't expect to leak more than ~16M IDs per session but
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
export function uploadPngEscape(pngBytes: Uint8Array, id: number): string {
  const b64 = encodeBase64(pngBytes)
  const chunks = chunkString(b64, MAX_BASE64_CHUNK)
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    const m = isLast ? 0 : 1
    let header: string
    if (i === 0) {
      // a=t (transmit), t=d (direct), f=100 (PNG), q=2 (quiet).
      header = `q=2,a=t,t=d,f=100,i=${id},m=${m}`
    } else {
      header = `m=${m},q=2`
    }
    parts.push(`${ESC}_G${header};${chunks[i]}${ST}`)
  }
  return wrapForTmux(parts.join(''))
}

export function deleteImageEscape(id: number): string {
  return wrapForTmux(`${ESC}_Ga=d,d=I,i=${id},q=2;${ST}`)
}

export function imageIdToRgb(id: number): [number, number, number] {
  return idToRgb(id)
}

export function writeRaw(seq: string): void {
  // Synchronous write so we don't interleave with opentui frames.
  process.stdout.write(seq)
}
