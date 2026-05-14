#!/usr/bin/env bun
/* eslint-disable no-console -- developer script, console is the UI */
// Regenerate the tiny image fixtures under assets/demo-images/.
//
// Writes a hand-crafted source PNG, GIF, BMP, SVG, then transcodes the PNG to
// JPEG (via sips) and WebP (via cwebp). Run from the repo root:
//
//   bun run scripts/build-demo-images.ts
//
// Requires `sips` (macOS, for jpeg) and `cwebp` (for webp) in PATH.

import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const OUT_DIR = join(import.meta.dir, '..', 'assets', 'demo-images')

// 16×16 solid PNG.
function makePng(rgb: [number, number, number]): Uint8Array {
  const width = 16
  const height = 16
  const [r, g, b] = rgb

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdrData = new Uint8Array(13)
  const ihdrView = new DataView(ihdrData.buffer)
  ihdrView.setUint32(0, width, false)
  ihdrView.setUint32(4, height, false)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type RGB
  ihdrData[10] = 0
  ihdrData[11] = 0
  ihdrData[12] = 0
  const ihdr = chunk('IHDR', ihdrData)

  // Build raw scanlines: each row = filter byte 0 + width*3 bytes.
  const raw = new Uint8Array((1 + width * 3) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const off = y * (1 + width * 3) + 1 + x * 3
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
    }
  }
  const compressed = deflateSync(raw) // node:zlib emits zlib-wrapped DEFLATE (required by PNG)
  const idat = chunk('IDAT', new Uint8Array(compressed))
  const iend = chunk('IEND', new Uint8Array(0))

  return concat([sig, ihdr, idat, iend])
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, data.length, false)
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ])
  const crc = crc32(concat([typeBytes, data]))
  const crcBytes = new Uint8Array(4)
  new DataView(crcBytes.buffer).setUint32(0, crc, false)
  return concat([len, typeBytes, data, crcBytes])
}

let crcTable: Uint32Array | null = null
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

// Minimal 16×16 solid GIF87a.
function makeGif(rgb: [number, number, number]): Uint8Array {
  const w = 16
  const h = 16
  const header = new Uint8Array([
    0x47,
    0x49,
    0x46,
    0x38,
    0x37,
    0x61, // GIF87a
    w & 0xff,
    w >> 8,
    h & 0xff,
    h >> 8,
    0xf0, // global color table flag, 2-color table
    0x00,
    0x00,
    rgb[0],
    rgb[1],
    rgb[2], // color 0
    0xff,
    0xff,
    0xff, // color 1 (unused)
    0x2c, // image descriptor
    0,
    0,
    0,
    0,
    w & 0xff,
    w >> 8,
    h & 0xff,
    h >> 8,
    0x00, // local color table flag
    0x02, // LZW min code size
  ])
  // LZW for a stream of 256 zeros — encoded as two short blocks.
  // Simplest valid: emit clear code, 256 single-pixel codes? That's a lot. Use
  // a single sub-block with terminator.
  // We'll build a trivial encoded stream: clear code (4) + 256 zeros + EOI (5),
  // packed at 3-bit codes.
  const bits: number[] = []
  const writeCode = (code: number, n: number) => {
    for (let i = 0; i < n; i++) bits.push((code >> i) & 1)
  }
  writeCode(4, 3) // clear
  for (let i = 0; i < w * h; i++) writeCode(0, 3)
  writeCode(5, 3) // EOI
  // Pack bits into bytes.
  const bytes: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte |= (bits[i + j] ?? 0) << j
    bytes.push(byte)
  }
  // Sub-block(s) of ≤ 255 bytes each, then terminator.
  const subBlocks: number[] = []
  for (let i = 0; i < bytes.length; i += 255) {
    const slice = bytes.slice(i, i + 255)
    subBlocks.push(slice.length, ...slice)
  }
  subBlocks.push(0x00) // sub-block terminator
  const trailer = new Uint8Array([0x3b])
  return concat([header, new Uint8Array(subBlocks), trailer])
}

// Minimal 16×16 24-bit BMP.
function makeBmp(rgb: [number, number, number]): Uint8Array {
  const w = 16
  const h = 16
  const rowSize = ((w * 3 + 3) >> 2) << 2 // 4-byte aligned
  const pixelSize = rowSize * h
  const fileSize = 54 + pixelSize
  const out = new Uint8Array(fileSize)
  const v = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  v.setUint32(2, fileSize, true)
  v.setUint32(10, 54, true)
  v.setUint32(14, 40, true) // DIB header size
  v.setInt32(18, w, true)
  v.setInt32(22, h, true)
  v.setUint16(26, 1, true) // planes
  v.setUint16(28, 24, true) // bpp
  v.setUint32(34, pixelSize, true)
  v.setUint32(38, 2835, true) // x ppm
  v.setUint32(42, 2835, true) // y ppm
  let off = 54
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[off++] = rgb[2]
      out[off++] = rgb[1]
      out[off++] = rgb[0]
    }
    off += rowSize - w * 3
  }
  return out
}

function makeSvg(): Uint8Array {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="#5b8def" stroke="#0a2540" stroke-width="3"/>
</svg>
`
  return new TextEncoder().encode(svg)
}

async function sipsTo(format: string, srcPath: string, dstPath: string): Promise<void> {
  const proc = Bun.spawn(['sips', '-s', 'format', format, srcPath, '--out', dstPath], {
    stderr: 'ignore',
    stdout: 'ignore',
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`sips ${format} failed for ${dstPath}`)
}

async function cwebpTo(srcPath: string, dstPath: string): Promise<void> {
  const proc = Bun.spawn(['cwebp', '-quiet', '-lossless', srcPath, '-o', dstPath], {
    stderr: 'ignore',
    stdout: 'ignore',
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`cwebp failed for ${dstPath}`)
}

async function main() {
  const pngPath = join(OUT_DIR, 'square-red.png')
  await Bun.write(pngPath, makePng([220, 60, 60]))
  await Bun.write(join(OUT_DIR, 'gradient.gif'), makeGif([60, 180, 90]))
  await Bun.write(join(OUT_DIR, 'icon.bmp'), makeBmp([90, 110, 220]))
  await Bun.write(join(OUT_DIR, 'vector.svg'), makeSvg())

  await sipsTo('jpeg', pngPath, join(OUT_DIR, 'square-blue.jpg'))
  await cwebpTo(pngPath, join(OUT_DIR, 'dot.webp'))

  console.log('demo images written to', OUT_DIR)
}

await main()
