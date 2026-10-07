import { memo } from 'react'

import type { DiffData, GitDiffView, GitMarkdownView } from '../../../state/types'
import type { ThemeId } from '../../themes'

import { diffByteLimit } from '../../../git/diff-limits'
import { isMarkdownPath } from '../../../markdown-diff'
import { formatBytes } from '../../terminal-graphics/dimensions'
import { useTheme } from '../../theme'
import { PierreDiff, type PierreDiffHandle } from './diff-renderer'
import { ImageDiffView } from './image-diff'
import { MarkdownDiffView } from './markdown-diff'
import { PdfDiffView } from './pdf-diff'

/**
 * What a changed file is drawn as: the right renderer for what it holds, or a
 * line saying why there is nothing to draw. Git mode's, and a plugin file
 * view's when the file it shows has changed.
 */

interface DiffStageProps {
  diff: DiffData | undefined
  diffKey: string | null
  loading: boolean
  markdownExpanded: boolean
  markdownView: GitMarkdownView
  /** Named in a rendered Markdown diff's header as the way to its source. */
  markdownSourceKey?: string | null
  repoRoot: string | null
  diffRef?: React.RefObject<PierreDiffHandle | null>
  themeId: ThemeId
  view: GitDiffView
}

function placeholderText(diff: DiffData): string | null {
  if (diff.status === 'too-large') {
    const before = diff.binarySizeBefore ?? 0
    const after = diff.binarySizeAfter ?? 0
    const largest = Math.max(before, after)
    return `(file too large to diff — ${formatBytes(largest)}, limit ${formatBytes(diffByteLimit(diff.path))})`
  }
  if (diff.status === 'binary') {
    const before = diff.binarySizeBefore ?? 0
    const after = diff.binarySizeAfter ?? 0
    return `(binary file — ${before} → ${after} bytes)`
  }
  if (diff.rawDiff.length === 0) {
    if (diff.status === 'new') return '(new file — no diff)'
    if (diff.status === 'deleted') return '(deleted — no diff)'
    return '(no changes)'
  }
  return null
}

export const DiffStage = memo(function DiffStage({
  diff,
  diffKey,
  diffRef,
  loading,
  markdownExpanded,
  markdownSourceKey,
  markdownView,
  repoRoot,
  themeId,
  view,
}: DiffStageProps) {
  const t = useTheme()
  if (loading && !diff) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t.textMuted}>Loading diff…</text>
      </box>
    )
  }
  if (!diff) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t.textMuted}>Select a file.</text>
      </box>
    )
  }
  if (diff.errorMessage != null && diff.errorMessage !== '') {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t.error}>{diff.errorMessage}</text>
      </box>
    )
  }

  if (diff.status === 'image') {
    return <ImageDiffView diff={diff} />
  }

  if (diff.status === 'pdf') {
    return <PdfDiffView diff={diff} />
  }

  const placeholder = placeholderText(diff)
  if (placeholder != null && placeholder !== '') {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t.textMuted}>{placeholder}</text>
      </box>
    )
  }

  if (markdownView === 'rendered' && isMarkdownPath(diff.path)) {
    return (
      <MarkdownDiffView
        diff={diff}
        expandAll={markdownExpanded}
        sourceKey={markdownSourceKey}
        repoRoot={repoRoot}
        themeId={themeId}
        view={view}
      />
    )
  }

  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden">
      {diff.oldPath != null && diff.oldPath !== '' ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={t.textMuted}>
            renamed: {diff.oldPath} → {diff.path}
          </text>
        </box>
      ) : null}
      <PierreDiff
        cacheKey={diffKey ?? diff.path}
        ref={diffRef}
        diff={diff.rawDiff}
        path={diff.path}
        themeId={themeId}
        view={view}
      />
    </box>
  )
})
