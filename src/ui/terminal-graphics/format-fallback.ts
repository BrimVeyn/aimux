// Convert non-PNG image bytes to PNG. SVGs go through @resvg/resvg-wasm
// (zero-install). Everything else tries the system converter chain. Results
// are cached per byte-source so we don't retry on every render.

import { isSvg, renderSvgToPng } from './svg-render'

export type ConvertResult = { kind: 'ok'; png: Uint8Array } | { kind: 'error'; reason: string }

const cache = new Map<string, ConvertResult>()

function cacheKey(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha1').update(bytes).digest('hex')
}

async function tryConverter(
  cmd: string[],
  bytes: Uint8Array,
  timeoutMs: number
): Promise<Uint8Array | null> {
  try {
    const proc = Bun.spawn(cmd, {
      stderr: 'ignore',
      stdin: 'pipe',
      stdout: 'pipe',
    })
    const writer = proc.stdin
    if (writer) {
      writer.write(bytes)
      await writer.end()
    }
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    const [out, code] = await Promise.all([new Response(proc.stdout).bytes(), proc.exited])
    clearTimeout(timer)
    if (code !== 0 || out.byteLength === 0) return null
    return out
  } catch {
    return null
  }
}

// For sips (macOS) we must write to a temp file because it doesn't accept stdin.
async function trySips(bytes: Uint8Array): Promise<Uint8Array | null> {
  const tmpIn = `${(Bun.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/aimux-img-in-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tmpOut = `${tmpIn}.png`
  try {
    await Bun.write(tmpIn, bytes)
    const proc = Bun.spawn(['sips', '-s', 'format', 'png', tmpIn, '--out', tmpOut], {
      stderr: 'ignore',
      stdout: 'ignore',
    })
    const timer = setTimeout(() => proc.kill(), 1500)
    const code = await proc.exited
    clearTimeout(timer)
    if (code !== 0) return null
    const file = Bun.file(tmpOut)
    if (!(await file.exists())) return null
    return await file.bytes()
  } catch {
    return null
  } finally {
    await Promise.all([
      Bun.file(tmpIn)
        .delete()
        .catch(() => {}),
      Bun.file(tmpOut)
        .delete()
        .catch(() => {}),
    ])
  }
}

function mimeLabel(mime: string): string {
  const slash = mime.indexOf('/')
  if (slash < 0) return mime
  return mime.slice(slash + 1).toUpperCase()
}

export async function convertToPng(bytes: Uint8Array, mime: string): Promise<ConvertResult> {
  const key = cacheKey(bytes)
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let result: ConvertResult
  if (isSvg(bytes)) {
    const png = await renderSvgToPng(bytes)
    result = png ? { kind: 'ok', png } : { kind: 'error', reason: 'failed to render SVG' }
  } else {
    const attempts: Array<() => Promise<Uint8Array | null>> = [
      () => tryConverter(['magick', '-', 'png:-'], bytes, 1500),
      () => tryConverter(['convert', '-', 'png:-'], bytes, 1500),
      () => trySips(bytes),
      () =>
        tryConverter(
          [
            'ffmpeg',
            '-loglevel',
            'error',
            '-i',
            'pipe:0',
            '-f',
            'image2',
            '-vcodec',
            'png',
            'pipe:1',
          ],
          bytes,
          2500
        ),
    ]

    let converted: Uint8Array | null = null
    for (const attempt of attempts) {
      const out = await attempt()
      if (out && out.byteLength > 0) {
        converted = out
        break
      }
    }
    result = converted
      ? { kind: 'ok', png: converted }
      : {
          kind: 'error',
          reason: `no converter could decode this ${mimeLabel(mime)} (install ImageMagick or cwebp)`,
        }
  }

  cache.set(key, result)
  return result
}

export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}
