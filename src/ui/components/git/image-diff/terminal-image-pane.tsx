import type { BoxRenderable } from '@opentui/core'

import { memo, useCallback, useEffect, useRef, useState } from 'react'

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
  mime: string
}

interface PaneState {
  imageId: number | null
  lastKey: string | null
  uploaded: boolean
}

// Move-cursor + Kitty placement escape, sent via process.nextTick so it lands
// AFTER opentui's native cell flush for the same frame. Otherwise the cell
// writes overwrite the image overlay.
function buildPlacement(id: number, screenX: number, screenY: number): string {
  const [r, g, b] = imageIdToRgb(id)
  const move = `\x1b[${screenY + 1};${screenX + 1}H`
  const color = `\x1b[38;2;${r};${g};${b}m`
  const reset = `\x1b[39m`
  // a=p (put placement), C=1 (cursor stays put), q=2 (quiet).
  const place = `\x1b_Ga=p,i=${id},C=1,q=2;\x1b\\`
  return `${move}${color}${place}${reset}`
}

export const TerminalImagePane = memo(function TerminalImagePane({
  bytes,
  mime,
}: TerminalImagePaneProps) {
  const t = useTheme()
  const stateRef = useRef<PaneState>({ imageId: null, lastKey: null, uploaded: false })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    stateRef.current = { imageId: null, lastKey: null, uploaded: false }
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

  const renderAfter = useCallback(function (this: BoxRenderable): void {
    const state = stateRef.current
    if (!state.uploaded || state.imageId === null) return
    const key = `${this.screenX},${this.screenY},${this.width},${this.height}`
    if (state.lastKey === key) return
    state.lastKey = key
    const seq = buildPlacement(state.imageId, this.screenX, this.screenY)
    // Queue write to land AFTER opentui's native cell flush in this frame.
    process.nextTick(() => writeRaw(seq))
  }, [])

  if (error != null && error !== '') {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" padding={1}>
        <text fg={t.warning}>({error})</text>
      </box>
    )
  }

  return <box flexGrow={1} renderAfter={renderAfter} />
})
