import { useRenderer } from '@opentui/react'
import { memo } from 'react'

import type { DiffData } from '../../../../state/types'

import {
  detectGraphicsProtocol,
  isInsideTmux,
  terminalLabel,
} from '../../../terminal-graphics/capabilities'
import { useTheme } from '../../../theme'
import { formatBytes, readImageDimensions } from './dimensions'
import { TerminalImagePane } from './terminal-image-pane'

interface ImageDiffViewProps {
  diff: DiffData
}

interface PaneProps {
  bytes: Uint8Array | undefined
  formatLabel: string
  label: string
  mime: string
  protocol: 'kitty' | 'iterm' | 'none'
}

const Pane = memo(function Pane({ bytes, formatLabel, label, mime, protocol }: PaneProps) {
  const t = useTheme()
  if (!bytes) {
    return (
      <box flexDirection="column" flexGrow={1} padding={1}>
        <text fg={t.textMuted}>{label}</text>
        <text fg={t.textMuted}>(absent)</text>
      </box>
    )
  }
  const dims = readImageDimensions(bytes)
  const meta = [
    formatLabel,
    formatBytes(bytes.byteLength),
    dims ? `${dims.width}×${dims.height}` : null,
  ]
    .filter((s) => s !== null)
    .join(' · ')
  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <text fg={t.text}>{label}</text>
      {protocol === 'kitty' ? (
        <TerminalImagePane bytes={bytes} mime={mime} />
      ) : (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={t.textMuted}>(no preview)</text>
        </box>
      )}
      <text fg={t.textMuted}>{meta}</text>
    </box>
  )
})

export const ImageDiffView = memo(function ImageDiffView({ diff }: ImageDiffViewProps) {
  const t = useTheme()
  const renderer = useRenderer()
  const protocol = detectGraphicsProtocol(renderer)
  const before = diff.imageBytesBefore
  const after = diff.imageBytesAfter
  const mime = diff.imageMime ?? 'application/octet-stream'
  const formatLabel = diff.imageFormatLabel ?? 'image'

  const banner = (() => {
    if (protocol === 'kitty') return isInsideTmux() ? 'tmux: requires allow-passthrough on' : null
    if (protocol === 'iterm')
      return 'Image preview unavailable in iTerm2 (open externally to view).'
    return `Image preview requires a Kitty-compatible terminal (Kitty, Ghostty, WezTerm). Detected: ${terminalLabel()}.`
  })()

  const showBoth = before && after
  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden" backgroundColor={t.background}>
      {diff.oldPath ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={t.textMuted}>
            renamed: {diff.oldPath} → {diff.path}
          </text>
        </box>
      ) : null}
      {banner ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={protocol === 'kitty' ? t.textMuted : t.warning}>{banner}</text>
        </box>
      ) : null}
      <box flexDirection="row" flexGrow={1}>
        {showBoth || before ? (
          <Pane
            bytes={before}
            formatLabel={formatLabel}
            label="old (HEAD)"
            mime={mime}
            protocol={protocol}
          />
        ) : null}
        {showBoth || after ? (
          <Pane
            bytes={after}
            formatLabel={formatLabel}
            label="new (working)"
            mime={mime}
            protocol={protocol}
          />
        ) : null}
      </box>
    </box>
  )
})
