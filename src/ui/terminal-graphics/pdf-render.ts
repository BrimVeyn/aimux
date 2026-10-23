// Rasterises PDF pages for the diff view. Poppler does the work (`pdftoppm`,
// `pdfinfo`, `pdftotext`), with ImageMagick as a fallback renderer — no PDF
// engine ships with aimux. Every result is cached per document hash, so paging
// back and forth never spawns twice for the same page, and every process is
// killed once nobody is waiting on it any more.

import { type ConvertResult, tryConverter } from './format-fallback'

const RENDER_TIMEOUT_MS = 8000
const FINGERPRINT_TIMEOUT_MS = 20000
// Low enough to fingerprint a long document in a second or two, high enough that a
// changed digit still moves pixels.
const FINGERPRINT_DPI = 36
const MAX_FINGERPRINT_PAGES = 500
const MAX_CACHED_PAGES = 64
// How often a fingerprint pass still running reports the pages it has so far.
const PROGRESS_INTERVAL_MS = 100

const hashes = new WeakMap<Uint8Array, string>()
const pageCounts = new Map<string, number>()
const pages = new Map<string, Shared<ConvertResult>>()
const texts = new Map<string, Shared<string[] | null>>()
const rasters = new Map<string, RasterPass>()

function docHash(bytes: Uint8Array): string {
  let hash = hashes.get(bytes)
  if (hash === undefined) {
    hash = new Bun.CryptoHasher('sha1').update(bytes).digest('hex')
    hashes.set(bytes, hash)
  }
  return hash
}

/** Same for the same content, whichever array it arrived in. */
export function pdfDocumentKey(bytes: Uint8Array): string {
  return docHash(bytes)
}

function sha1(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha1').update(bytes).digest('hex')
}

// A job several callers may wait on. It runs until the last of them stops
// waiting, then its process is killed and the job forgotten, so the next caller
// starts it again rather than inheriting a result that was cut short.
class Shared<T> {
  readonly controller = new AbortController()
  readonly promise: Promise<T>
  settled = false
  waiters = 0

  constructor(start: (signal: AbortSignal) => Promise<T>) {
    this.promise = this.run(start)
  }

  private async run(start: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await start(this.controller.signal)
    } finally {
      this.settled = true
    }
  }
}

async function share<T>(
  cache: Map<string, Shared<T>>,
  key: string,
  start: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  let job = cache.get(key)
  if (!job) {
    job = new Shared(start)
    cache.set(key, job)
  }
  // A caller without a signal waits for good: the job is never cancelled for it.
  if (signal) {
    const held = job
    held.waiters += 1
    const leave = (): void => {
      held.waiters -= 1
      if (held.waiters > 0 || held.settled) return
      held.controller.abort()
      if (cache.get(key) === held) cache.delete(key)
    }
    if (signal.aborted) leave()
    else signal.addEventListener('abort', leave, { once: true })
  } else {
    job.waiters = Number.POSITIVE_INFINITY
  }
  return job.promise
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
  dpi: number,
  signal: AbortSignal
): Promise<ConvertResult> {
  const attempts: string[][] = [
    ['pdftoppm', '-png', '-r', `${dpi}`, '-f', `${page}`, '-l', `${page}`, '-singlefile'],
    ['magick', '-density', `${dpi}`, `pdf:-[${page - 1}]`, 'png:-'],
  ]
  for (const cmd of attempts) {
    if (signal.aborted) break
    const png = await tryConverter(cmd, bytes, RENDER_TIMEOUT_MS, signal)
    if (png && png.byteLength > 0) return { kind: 'ok', png }
  }
  return { kind: 'error', reason: 'could not render this PDF (install poppler)' }
}

/**
 * One page, 1-based, as PNG. `signal` says when this caller stops waiting; the
 * render is killed once every caller has.
 */
export async function renderPdfPage(
  bytes: Uint8Array,
  page: number,
  dpi: number,
  signal?: AbortSignal
): Promise<ConvertResult> {
  const key = `${docHash(bytes)}:${page}:${dpi}`
  const pending = share(pages, key, async (s) => renderUncached(bytes, page, dpi, s), signal)
  // Refresh its place, then drop the oldest entries past the bound.
  const job = pages.get(key)
  if (job) {
    pages.delete(key)
    pages.set(key, job)
  }
  while (pages.size > MAX_CACHED_PAGES) {
    const oldest = pages.keys().next().value
    if (oldest === undefined) break
    pages.delete(oldest)
  }
  return pending
}

// `pdftotext` ends every page with a form feed. UTF-8 never uses that byte
// inside a character, so the output splits on it without decoding.
function splitPages(out: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = []
  let start = 0
  for (let i = out.indexOf(0x0c); i !== -1; i = out.indexOf(0x0c, start)) {
    parts.push(out.subarray(start, i))
    start = i + 1
  }
  return parts
}

/**
 * A hash of each page's text, every page of the document, in page order. Text
 * comes out of a PDF far faster than pixels, so this finds most changes before
 * the raster pass has drawn its first pages. Null when nothing could read it.
 */
export async function pdfTextFingerprints(
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<string[] | null> {
  return share(
    texts,
    docHash(bytes),
    async (s) => {
      const cmd = ['pdftotext', '-enc', 'UTF-8', '-', '-']
      const out = await tryConverter(cmd, bytes, FINGERPRINT_TIMEOUT_MS, s)
      // A document without a single character still ends its pages, so empty
      // output is a failure, not an empty document.
      return out ? splitPages(out).map(sha1) : null
    },
    signal
  )
}

// pdftoppm, given no output root, writes every page to stdout as one binary
// PPM after another: `P6 <width> <height> <maxval>`, one whitespace byte, then
// the pixels. Each page is hashed as it streams past, header included.
class PpmPageHasher {
  private header = ''
  private hasher: Bun.CryptoHasher | null = null
  private remaining = 0

  constructor(private readonly onPage: (hash: string) => void) {}

  /** False once the stream stops looking like PPM. */
  push(chunk: Uint8Array): boolean {
    let i = 0
    while (i < chunk.length) {
      if (this.hasher === null) {
        this.header += String.fromCharCode(chunk[i] ?? 0)
        i += 1
        const match = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s$/.exec(this.header)
        if (match) {
          const [width, height, maxval] = match.slice(1).map(Number) as [number, number, number]
          this.hasher = new Bun.CryptoHasher('sha1').update(this.header)
          this.remaining = width * height * (maxval < 256 ? 3 : 6)
          this.header = ''
        } else if (this.header.length > 64) {
          return false
        }
        continue
      }
      const take = Math.min(this.remaining, chunk.length - i)
      this.hasher.update(chunk.subarray(i, i + take))
      i += take
      this.remaining -= take
      if (this.remaining === 0) {
        this.onPage(this.hasher.digest('hex'))
        this.hasher = null
      }
    }
    return true
  }
}

/** What a fingerprint pass has found so far. Null hashes: nothing could render. */
export interface FingerprintProgress {
  done: boolean
  hashes: readonly string[] | null
}

type ProgressListener = (progress: FingerprintProgress) => void

// One raster pass per document, shared by everyone watching it.
interface RasterPass {
  controller: AbortController
  listeners: Set<ProgressListener>
  progress: FingerprintProgress
}

async function rasterize(bytes: Uint8Array, pass: RasterPass): Promise<void> {
  const found: string[] = []
  let last = 0
  const publish = (done: boolean, failed = false): void => {
    pass.progress = { done, hashes: failed ? null : [...found] }
    last = performance.now()
    for (const listener of pass.listeners) listener(pass.progress)
  }
  const hasher = new PpmPageHasher((hash) => {
    found.push(hash)
    if (performance.now() - last >= PROGRESS_INTERVAL_MS) publish(false)
  })
  try {
    // PPM, not PNG: the pixels are only hashed, and PNG compression was most of
    // the time spent — four times faster over a long book.
    const cmd = ['pdftoppm', '-r', `${FINGERPRINT_DPI}`, '-l', `${MAX_FINGERPRINT_PAGES}`, '-']
    const proc = Bun.spawn(cmd, {
      signal: pass.controller.signal,
      stderr: 'ignore',
      stdin: bytes,
      stdout: 'pipe',
      timeout: FINGERPRINT_TIMEOUT_MS,
    })
    let readable = true
    for await (const chunk of proc.stdout) {
      if (readable) readable = hasher.push(chunk)
    }
    const code = await proc.exited
    if (pass.controller.signal.aborted) return
    publish(true, code !== 0 || !readable)
  } catch {
    if (!pass.controller.signal.aborted) publish(true, true)
  }
}

/**
 * A hash per page, rendered small, in page order, reported as the pages come
 * in. Two pages that draw the same are the same page, whatever the PDF bytes
 * say. Returns the unsubscribe; the pass is killed when its last watcher leaves
 * before it ends, and a finished pass is kept for the next one.
 */
export function watchPdfPageFingerprints(
  bytes: Uint8Array,
  listener: ProgressListener
): () => void {
  const key = docHash(bytes)
  let pass = rasters.get(key)
  if (!pass) {
    const created: RasterPass = {
      controller: new AbortController(),
      listeners: new Set(),
      progress: { done: false, hashes: [] },
    }
    rasters.set(key, created)
    void rasterize(bytes, created)
    pass = created
  }
  const held = pass
  held.listeners.add(listener)
  listener(held.progress)
  return () => {
    held.listeners.delete(listener)
    if (held.listeners.size > 0 || held.progress.done) return
    held.controller.abort()
    if (rasters.get(key) === held) rasters.delete(key)
  }
}

/** The whole fingerprint pass at once. Null when nothing could render. */
export async function pdfPageFingerprints(bytes: Uint8Array): Promise<string[] | null> {
  return new Promise((resolve) => {
    // Never unsubscribed: a pass nobody leaves runs to the end and stays cached.
    watchPdfPageFingerprints(bytes, ({ done, hashes: found }) => {
      if (done) resolve(found ? [...found] : null)
    })
  })
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

/**
 * The pages two passes still running already know to differ. A side still
 * working says nothing past its last page; a finished one says the pages past
 * its last do not exist.
 */
export function changedPagesSoFar(
  before: { done: boolean; hashes: readonly string[] },
  after: { done: boolean; hashes: readonly string[] }
): number[] {
  const out: number[] = []
  const total = Math.max(before.hashes.length, after.hashes.length)
  for (let i = 0; i < total; i++) {
    const known =
      (i < before.hashes.length || before.done) && (i < after.hashes.length || after.done)
    if (known && before.hashes[i] !== after.hashes[i]) out.push(i + 1)
  }
  return out
}
