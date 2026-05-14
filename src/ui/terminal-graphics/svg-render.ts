// SVG → PNG rendering via @resvg/resvg-wasm. WASM is loaded once per process
// from the package's bundled `index_bg.wasm`; subsequent renders reuse it.

import { initWasm, Resvg } from '@resvg/resvg-wasm'

let initPromise: Promise<void> | null = null

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const wasmUrl = import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm')
      const bytes = await Bun.file(new URL(wasmUrl)).bytes()
      await initWasm(bytes)
    })()
  }
  await initPromise
}

export async function renderSvgToPng(svgBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    await ensureInit()
    // 1024px wide is plenty for any TUI cell grid; Kitty scales to fit.
    const resvg = new Resvg(svgBytes, { fitTo: { mode: 'width', value: 1024 } })
    const rendered = resvg.render()
    const png = rendered.asPng()
    rendered.free()
    resvg.free()
    return png
  } catch {
    return null
  }
}

export function isSvg(bytes: Uint8Array): boolean {
  // Accept files that open with an XML prolog or whitespace before <svg.
  const max = Math.min(bytes.length, 256)
  for (let i = 0; i + 3 < max; i++) {
    if (
      bytes[i] === 0x3c && // <
      bytes[i + 1] === 0x73 && // s
      bytes[i + 2] === 0x76 && // v
      bytes[i + 3] === 0x67 // g
    ) {
      return true
    }
  }
  return false
}
