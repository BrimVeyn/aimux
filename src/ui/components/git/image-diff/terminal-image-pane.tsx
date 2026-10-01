import type { BoxRenderable } from '@opentui/core'

import { useRenderer } from '@opentui/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { type ImageDimensions, readImageDimensions } from '../../../terminal-graphics/dimensions'
import { convertToPng, isPng } from '../../../terminal-graphics/format-fallback'
import {
  deleteImageEscape,
  imageIdToRgb,
  nextImageId,
  uploadPngEscape,
  writeRaw,
} from '../../../terminal-graphics/kitty'
import { useTheme } from '../../../theme'

interface TerminalImagePaneProps {
  bytes: Uint8Array
  /** Scale the image down or up to the pane, keeping its aspect, centred. */
  fit?: boolean
  mime: string
}

interface PaneState {
  dims: ImageDimensions | null
  imageId: number | null
  lastKey: string | null
  uploaded: boolean
}

interface Box {
  cols?: number
  rows?: number
  x: number
  y: number
}

// Pixels per cell. Terminals that speak Kitty graphics report their size in pixels,
// so this is exact there; 1:2 is the shape of nearly every monospace cell otherwise.
function cellSize(renderer: ReturnType<typeof useRenderer>): { h: number; w: number } {
  const res = renderer.resolution
  if (res && renderer.width > 0 && renderer.height > 0) {
    return { h: res.height / renderer.height, w: res.width / renderer.width }
  }
  return { h: 2, w: 1 }
}

function fitBox(
  pane: { height: number; width: number; x: number; y: number },
  dims: ImageDimensions,
  cell: { h: number; w: number }
): Box {
  const scale = Math.min((pane.width * cell.w) / dims.width, (pane.height * cell.h) / dims.height)
  const cols = Math.max(1, Math.min(pane.width, Math.floor((dims.width * scale) / cell.w)))
  const rows = Math.max(1, Math.min(pane.height, Math.floor((dims.height * scale) / cell.h)))
  return {
    cols,
    rows,
    x: pane.x + Math.floor((pane.width - cols) / 2),
    y: pane.y + Math.floor((pane.height - rows) / 2),
  }
}

// Move-cursor + Kitty placement escape, sent via process.nextTick so it lands
// AFTER opentui's native cell flush for the same frame. Otherwise the cell
// writes overwrite the image overlay.
function buildPlacement(id: number, box: Box): string {
  const [r, g, b] = imageIdToRgb(id)
  const move = `\x1b[${box.y + 1};${box.x + 1}H`
  const color = `\x1b[38;2;${r};${g};${b}m`
  const reset = `\x1b[39m`
  // c/r scale the image into that many cells; absent, it draws at its own pixel size.
  const size =
    box.cols !== undefined && box.rows !== undefined ? `,c=${box.cols},r=${box.rows}` : ''
  // a=p (put placement), p=1 (one placement per image, replaced on each move),
  // C=1 (cursor stays put), q=2 (quiet).
  const place = `\x1b_Ga=p,i=${id},p=1${size},C=1,q=2;\x1b\\`
  return `${move}${color}${place}${reset}`
}

export const TerminalImagePane = memo(function TerminalImagePane({
  bytes,
  fit = false,
  mime,
}: TerminalImagePaneProps) {
  const t = useTheme()
  const renderer = useRenderer()
  const stateRef = useRef<PaneState>({
    dims: null,
    imageId: null,
    lastKey: null,
    uploaded: false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    stateRef.current = { dims: null, imageId: null, lastKey: null, uploaded: false }
    setError(null)
    void (async () => {
      let pngBytes: Uint8Array | null = null
      if (mime === 'image/png' || isPng(bytes)) {
        pngBytes = bytes
      } else {
        const result = await convertToPng(bytes, mime)
        if (cancelled) return
        if (result.kind === 'error') {
          setError(result.reason)
          return
        }
        pngBytes = result.png
      }
      if (cancelled) return
      const id = nextImageId()
      writeRaw(uploadPngEscape(pngBytes, id))
      stateRef.current.dims = readImageDimensions(pngBytes)
      stateRef.current.imageId = id
      stateRef.current.uploaded = true
      // Force re-placement on the next render.
      stateRef.current.lastKey = null
    })()
    return () => {
      cancelled = true
      const id = stateRef.current.imageId
      if (id !== null) writeRaw(deleteImageEscape(id))
      stateRef.current = { dims: null, imageId: null, lastKey: null, uploaded: false }
    }
  }, [bytes, mime])

  const renderAfter = useCallback(
    function (this: BoxRenderable): void {
      const state = stateRef.current
      if (!state.uploaded || state.imageId === null) return
      const key = `${this.screenX},${this.screenY},${this.width},${this.height}`
      if (state.lastKey === key) return
      state.lastKey = key
      const pane = { height: this.height, width: this.width, x: this.screenX, y: this.screenY }
      const box =
        fit && state.dims && pane.width > 0 && pane.height > 0
          ? fitBox(pane, state.dims, cellSize(renderer))
          : { x: pane.x, y: pane.y }
      const seq = buildPlacement(state.imageId, box)
      // Queue write to land AFTER opentui's native cell flush in this frame.
      process.nextTick(() => writeRaw(seq))
    },
    [fit, renderer]
  )

  if (error != null && error !== '') {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" padding={1}>
        <text fg={t.warning}>({error})</text>
      </box>
    )
  }

  return <box flexGrow={1} renderAfter={renderAfter} />
})
