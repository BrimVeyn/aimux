// Rasterises PDF pages for the diff view. Poppler does the work (`pdftoppm`,
// `pdfinfo`), with ImageMagick as a fallback renderer — no PDF engine ships with
// aimux. Every result is cached per document hash, so paging back and forth never
// spawns twice for the same page.

import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ConvertResult, tryConverter } from './format-fallback'

const RENDER_TIMEOUT_MS = 8000
const FINGERPRINT_TIMEOUT_MS = 20000
// Low enough to fingerprint a long document in a second or two, high enough that a
// changed digit still moves pixels.
const FINGERPRINT_DPI = 36
const MAX_FINGERPRINT_PAGES = 500
const MAX_CACHED_PAGES = 64

const hashes = new WeakMap<Uint8Array, string>()
const pageCounts = new Map<string, number>()
const pages = new Map<string, Promise<ConvertResult>>()
const fingerprints = new Map<string, Promise<string[] | null>>()

function docHash(bytes: Uint8Array): string {
  let hash = hashes.get(bytes)
  if (hash === undefined) {
    hash = new Bun.CryptoHasher('sha1').update(bytes).digest('hex')
    hashes.set(bytes, hash)
  }
  return hash
}

async function run(cmd: string[], bytes: Uint8Array, timeoutMs: number): Promise<string | null> {
  const out = await tryConverter(cmd, bytes, timeoutMs)
  return out ? new TextDecoder().decode(out) : null
}

// Without pdfinfo, count page objects. Crude — a PDF can hide them in compressed
// object streams — but it only has to be right when pdfinfo is missing.
function countPageObjects(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes)
  return text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const key = docHash(bytes)
  const hit = pageCounts.get(key)
  if (hit !== undefined) return hit
  const info = await run(['pdfinfo', '-'], bytes, RENDER_TIMEOUT_MS)
  const parsed = /^Pages:\s+(\d+)/m.exec(info ?? '')
  const count = parsed ? Number.parseInt(parsed[1] ?? '0', 10) : countPageObjects(bytes)
  pageCounts.set(key, count)
  return count
}

async function renderUncached(
  bytes: Uint8Array,
  page: number,
  dpi: number
): Promise<ConvertResult> {
  const attempts: string[][] = [
    ['pdftoppm', '-png', '-r', `${dpi}`, '-f', `${page}`, '-l', `${page}`, '-singlefile'],
    ['magick', '-density', `${dpi}`, `pdf:-[${page - 1}]`, 'png:-'],
  ]
  for (const cmd of attempts) {
    const png = await tryConverter(cmd, bytes, RENDER_TIMEOUT_MS)
    if (png && png.byteLength > 0) return { kind: 'ok', png }
  }
  return { kind: 'error', reason: 'could not render this PDF (install poppler)' }
}

/** One page, 1-based, as PNG. */
export async function renderPdfPage(
  bytes: Uint8Array,
  page: number,
  dpi: number
): Promise<ConvertResult> {
  const key = `${docHash(bytes)}:${page}:${dpi}`
  const hit = pages.get(key)
  if (hit) return hit
  const pending = renderUncached(bytes, page, dpi)
  pages.set(key, pending)
  if (pages.size > MAX_CACHED_PAGES) {
    const oldest = pages.keys().next().value
    if (oldest !== undefined) pages.delete(oldest)
  }
  return pending
}

async function fingerprintUncached(bytes: Uint8Array): Promise<string[] | null> {
  const dir = await mkdtemp(join(tmpdir(), 'aimux-pdf-'))
  try {
    const cmd = [
      'pdftoppm',
      '-png',
      '-r',
      `${FINGERPRINT_DPI}`,
      '-l',
      `${MAX_FINGERPRINT_PAGES}`,
      '-',
      join(dir, 'p'),
    ]
    // pdftoppm writes its pages to the prefix, not stdout, so the empty-output check
    // in tryConverter would read success as failure — spawn directly.
    const proc = Bun.spawn(cmd, { stderr: 'ignore', stdin: bytes, stdout: 'ignore' })
    const timer = setTimeout(() => proc.kill(), FINGERPRINT_TIMEOUT_MS)
    const code = await proc.exited
    clearTimeout(timer)
    if (code !== 0) return null
    // `p-01.png`, `p-02.png`… zero-padded to the page count's width, so a plain sort
    // is page order.
    const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).toSorted()
    return await Promise.all(
      files.map(async (f) =>
        new Bun.CryptoHasher('sha1').update(await Bun.file(join(dir, f)).bytes()).digest('hex')
      )
    )
  } catch {
    return null
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => {})
  }
}

/**
 * A hash per page, rendered small, in page order. Two pages that draw the same are
 * the same page, whatever the PDF bytes say. Null when nothing could render.
 */
export async function pdfPageFingerprints(bytes: Uint8Array): Promise<string[] | null> {
  const key = docHash(bytes)
  const hit = fingerprints.get(key)
  if (hit) return hit
  const pending = fingerprintUncached(bytes)
  fingerprints.set(key, pending)
  return pending
}

/** 1-based numbers of the pages that differ between two fingerprint lists. */
export function changedPages(before: readonly string[], after: readonly string[]): number[] {
  const out: number[] = []
  const total = Math.max(before.length, after.length)
  for (let i = 0; i < total; i++) {
    if (before[i] !== after[i]) out.push(i + 1)
  }
  return out
}
