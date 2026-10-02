import { useRenderer } from '@opentui/react'
import { memo, useEffect, useState } from 'react'

import { imageMimeFromPath, isImagePath } from '../../../../git/image-detect'
import { detectGraphicsProtocol } from '../../../terminal-graphics/capabilities'
import { useTheme } from '../../../theme'
import { type ScreenRect, TerminalImagePane } from '../image-diff/terminal-image-pane'

// Tall enough to make out a screenshot, short enough that a README of badges and
// diagrams is not mostly pictures.
const IMAGE_ROWS = 12
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const bytesCache = new Map<string, Promise<Uint8Array | null>>()

/**
 * Where a Markdown image points inside the repo, or null for anything that is not
 * a local file: a URL, a data URI, a path that climbs out of the repo.
 */
export function resolveImagePath(repoRoot: string, mdPath: string, src: string): string | null {
  if (src === '' || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return null
  const clean = decodeURI(src.split(/[?#]/)[0] ?? '')
  if (!isImagePath(clean)) return null
  const parts = clean.startsWith('/') ? [] : mdPath.split('/').slice(0, -1)
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return `${repoRoot}/${parts.join('/')}`
}

async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists()) || file.size > MAX_IMAGE_BYTES) return null
    return await file.bytes()
  } catch {
    return null
  }
}

function loadBytes(path: string): Promise<Uint8Array | null> {
  let pending = bytesCache.get(path)
  if (!pending) {
    pending = readBytes(path)
    bytesCache.set(path, pending)
  }
  return pending
}

interface MdImageProps {
  alt: string
  mdPath: string
  repoRoot: string | null
  src: string
  visibleIn: () => ScreenRect | null
}

/**
 * An image the document embeds. Drawn from the working tree — both sides of the
 * diff show the file as it is now; a change to the picture itself is the image
 * diff's job, one entry down in the file list.
 */
export const MdImage = memo(function MdImage({
  alt,
  mdPath,
  repoRoot,
  src,
  visibleIn,
}: MdImageProps) {
  const t = useTheme()
  const renderer = useRenderer()
  const kitty = detectGraphicsProtocol(renderer) === 'kitty'
  const path = repoRoot === null ? null : resolveImagePath(repoRoot, mdPath, src)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)

  useEffect(() => {
    setBytes(null)
    if (!kitty || path === null) return
    let cancelled = false
    void (async () => {
      const loaded = await loadBytes(path)
      if (!cancelled) setBytes(loaded)
    })()
    return () => {
      cancelled = true
    }
  }, [kitty, path])

  const label = (
    <text fg={t.markdownImage}>
      <span fg={t.markdownImageText}>{alt === '' ? 'image' : alt}</span>
      <span fg={t.textMuted}> {src}</span>
    </text>
  )
  if (bytes === null || path === null) return label
  return (
    <box flexDirection="column">
      <box height={IMAGE_ROWS} flexDirection="row">
        <TerminalImagePane bytes={bytes} fit mime={imageMimeFromPath(path)} visibleIn={visibleIn} />
      </box>
      {label}
    </box>
  )
})
