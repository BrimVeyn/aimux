import { type BoxRenderable, type OptimizedBuffer, RGBA } from '@opentui/core'
import { memo, useEffect, useRef } from 'react'

import { convertToPng, isPng } from '../../../terminal-graphics/format-fallback'
import {
  deleteImageEscape,
  imageIdToRgb,
  nextImageId,
  uploadPngEscape,
  writeRaw,
} from '../../../terminal-graphics/kitty'

interface TerminalImagePaneProps {
  bytes: Uint8Array
  mime: string
}

interface PaneState {
  imageId: number | null
  lastKey: string | null
  uploaded: boolean
}

const TRANSPARENT_RGBA = RGBA.fromValues(0, 0, 0, 0)

// Move-cursor + Kitty placement escape, sent via process.nextTick so it lands
// AFTER opentui's native cell flush for the same frame. Otherwise the cell
// writes overwrite the image overlay.
function buildPlacement(id: number, screenX: number, screenY: number): string {
  const [r, g, b] = imageIdToRgb(id)
  // Move cursor to (row+1, col+1) — ANSI is 1-based, opentui screen coords are 0-based.
  const move = `\x1b[${screenY + 1};${screenX + 1}H`
  // Set foreground to image ID color, then emit a single placeholder cell that
  // tells Kitty "place image id=ID here". For pixel placement we use a=p with
  // C=1 (do not move cursor), q=2 (quiet). The image was uploaded with U=1 so
  // a placement is needed via virtual placeholder OR direct cell placement.
  // We use direct a=p placement with cursor preserved.
  const color = `\x1b[38;2;${r};${g};${b}m`
  const reset = `\x1b[39m`
  return `${move}${color}${placeImage(id)}${reset}`
}

function placeImage(id: number): string {
  // a=p (put placement), C=1 (cursor stays put), q=2 (quiet).
  // No placement id (p) → default placement; we delete by image id (d=I).
  return `\x1b_Ga=p,i=${id},C=1,q=2;\x1b\\`
}

function fillPaneCells(this: BoxRenderable, buffer: OptimizedBuffer): void {
  // Paint stable transparent cells over the pane's interior so opentui doesn't
  // re-emit a changing background that would erase the Kitty image overlay.
  const x0 = this.screenX
  const y0 = this.screenY
  const w = this.width
  const h = this.height
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      buffer.setCell(x, y, ' ', TRANSPARENT_RGBA, TRANSPARENT_RGBA)
    }
  }
}

export const TerminalImagePane = memo(function TerminalImagePane({
  bytes,
  mime,
}: TerminalImagePaneProps) {
  const stateRef = useRef<PaneState>({ imageId: null, lastKey: null, uploaded: false })

  useEffect(() => {
    let cancelled = false
    stateRef.current = { imageId: null, lastKey: null, uploaded: false }
    ;(async () => {
      let pngBytes: Uint8Array | null = null
      if (mime === 'image/png' || isPng(bytes)) {
        pngBytes = bytes
      } else {
        pngBytes = await convertToPng(bytes)
      }
      if (cancelled || !pngBytes) return
      const id = nextImageId()
      writeRaw(uploadPngEscape(pngBytes, id))
      stateRef.current.imageId = id
      stateRef.current.uploaded = true
      // Force re-placement on the next render.
      stateRef.current.lastKey = null
    })()
    return () => {
      cancelled = true
      const id = stateRef.current.imageId
      if (id !== null) writeRaw(deleteImageEscape(id))
      stateRef.current = { imageId: null, lastKey: null, uploaded: false }
    }
  }, [bytes, mime])

  const placeIfNeeded = (self: BoxRenderable) => {
    const state = stateRef.current
    if (!state.uploaded || state.imageId === null) return
    const key = `${self.screenX},${self.screenY},${self.width},${self.height}`
    if (state.lastKey === key) return
    state.lastKey = key
    const seq = buildPlacement(state.imageId, self.screenX, self.screenY)
    // Queue write to land AFTER opentui's native cell flush in this frame.
    process.nextTick(() => writeRaw(seq))
  }

  function renderAfter(this: BoxRenderable, buffer: OptimizedBuffer): void {
    fillPaneCells.call(this, buffer)
    placeIfNeeded(this)
  }

  return <box flexGrow={1} renderAfter={renderAfter} />
})
