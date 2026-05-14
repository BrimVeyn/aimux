// Lightweight pure-JS dimension extraction. Handles only the headers we care
// about (PNG, JPEG, GIF, WebP, BMP); other formats return null and the UI
// shows just the byte size.

export interface ImageDimensions {
  height: number
  width: number
}

function readPng(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null
  // PNG signature + IHDR chunk type at offset 12.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null
  const view = new DataView(b.buffer, b.byteOffset)
  return { height: view.getUint32(20, false), width: view.getUint32(16, false) }
}

function readGif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null
  const view = new DataView(b.buffer, b.byteOffset)
  return { height: view.getUint16(8, true), width: view.getUint16(6, true) }
}

function readBmp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 26) return null
  if (b[0] !== 0x42 || b[1] !== 0x4d) return null
  const view = new DataView(b.buffer, b.byteOffset)
  return { height: Math.abs(view.getInt32(22, true)), width: view.getInt32(18, true) }
}

function readWebp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null
  if (b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46) return null
  if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50) return null
  // VP8X chunk
  if (b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x58) {
    const view = new DataView(b.buffer, b.byteOffset)
    const w = (view.getUint32(24, true) & 0xffffff) + 1
    const h = ((view.getUint32(27, true) >> 8) & 0xffffff) + 1
    return { height: h, width: w }
  }
  // VP8L (lossless)
  if (b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x4c) {
    const view = new DataView(b.buffer, b.byteOffset)
    const bits = view.getUint32(21, true)
    return { height: ((bits >> 14) & 0x3fff) + 1, width: (bits & 0x3fff) + 1 }
  }
  // VP8 (lossy)
  if (b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x20) {
    const view = new DataView(b.buffer, b.byteOffset)
    return { height: view.getUint16(28, true) & 0x3fff, width: view.getUint16(26, true) & 0x3fff }
  }
  return null
}

function readJpeg(b: Uint8Array): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    // Skip padding 0xFF bytes
    while (i < b.length && b[i] === 0xff) i++
    if (i >= b.length) return null
    const marker = b[i] ?? 0
    i++
    // SOF markers: 0xC0..0xCF except 0xC4, 0xC8, 0xCC
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 >= b.length) return null
      const view = new DataView(b.buffer, b.byteOffset)
      const height = view.getUint16(i + 3, false)
      const width = view.getUint16(i + 5, false)
      return { height, width }
    }
    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (i + 1 >= b.length) return null
    const view = new DataView(b.buffer, b.byteOffset)
    const len = view.getUint16(i, false)
    i += len
  }
  return null
}

export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return readPng(bytes) ?? readJpeg(bytes) ?? readGif(bytes) ?? readWebp(bytes) ?? readBmp(bytes)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
