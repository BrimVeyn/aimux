// Convert non-PNG/JPEG image bytes to PNG using whichever system tool is
// available. Result cached per-byte-source so we don't reconvert on every render.

const cache = new Map<string, Uint8Array | null>()

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

export async function convertToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  const key = cacheKey(bytes)
  const hit = cache.get(key)
  if (hit !== undefined) return hit

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

  for (const attempt of attempts) {
    const result = await attempt()
    if (result && result.byteLength > 0) {
      cache.set(key, result)
      return result
    }
  }
  cache.set(key, null)
  return null
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
