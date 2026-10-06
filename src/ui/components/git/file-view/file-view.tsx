import {
  forwardRef,
  memo,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { GitMarkdownView } from '../../../../state/types'
import type { ThemeId } from '../../../themes'

import { type FileViewContent, type FileViewPrefer, loadFileView } from '../../../../git/file-view'
import { isMarkdownPath } from '../../../../markdown-diff'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { createDiffScrollSlot, DiffScrollContext } from '../../../git-view-controls'
import { formatBytes } from '../../../terminal-graphics/dimensions'
import { useTheme } from '../../../theme'
import { PierreDiff, type PierreDiffHandle } from '../diff-renderer'
import { DiffStage } from '../diff-stage'
import { ImageDiffView } from '../image-diff'
import { MarkdownDiffView } from '../markdown-diff'
import { PdfDiffView } from '../pdf-diff'

/**
 * One file of a repository, read-only: the diff renderers git mode draws with,
 * pointed at a file a browser picked rather than at a change.
 *
 * A changed file is drawn as git mode draws it, split against HEAD. Anything
 * else — untouched, untracked, or asked for as it is — is drawn once, in one
 * column, with the same rows, wrapping and highlighting.
 *
 * It owns its scrolling: the keys of whatever hosts it go through the handle,
 * and the wheel over it never reaches git mode's diff.
 */

export interface FileViewHandle {
  /** Lines for text, pages for a PDF — whatever the view shown scrolls by. */
  scroll: (delta: number) => void
}

export interface FileViewProps {
  /** The repository the path is relative to. Nothing is drawn without one. */
  cwd: string | null
  markdown?: GitMarkdownView
  path: string | null
  prefer?: FileViewPrefer
  /** Bumped to read the file again: what it was loaded from may have changed. */
  revision?: number
  themeId: ThemeId
}

interface Loaded {
  content: FileViewContent
  key: string
}

function Note({ children, tone }: { children: string; tone?: 'error' }): ReactNode {
  const t = useTheme()
  return (
    <box flexGrow={1} padding={1}>
      <text fg={tone === 'error' ? t.error : t.textMuted}>{children}</text>
    </box>
  )
}

/** A Markdown file as the document it renders to, both sides the same. */
function RenderedMarkdown({
  cwd,
  patch,
  path,
  themeId,
}: {
  cwd: string
  patch: string
  path: string
  themeId: ThemeId
}): ReactNode {
  const diff = useMemo(() => ({ path, rawDiff: patch, status: 'modified' as const }), [patch, path])
  return (
    <MarkdownDiffView
      diff={diff}
      expandAll
      repoRoot={cwd}
      single
      themeId={themeId}
      view="stacked"
    />
  )
}

const Content = memo(function Content({
  cacheKey,
  content,
  cwd,
  diffRef,
  markdown,
  path,
  themeId,
}: {
  cacheKey: string
  content: FileViewContent
  cwd: string
  diffRef: React.RefObject<PierreDiffHandle | null>
  markdown: GitMarkdownView
  path: string
  themeId: ThemeId
}) {
  switch (content.kind) {
    case 'diff':
      return (
        <DiffStage
          diff={content.diff}
          diffKey={cacheKey}
          diffRef={diffRef}
          loading={false}
          markdownExpanded={false}
          // The host binds the keys; git mode's `r` means nothing here.
          markdownSourceKey={null}
          markdownView={markdown}
          repoRoot={cwd}
          themeId={themeId}
          view="split"
        />
      )
    case 'image':
      return <ImageDiffView diff={content.diff} single />
    case 'pdf':
      return <PdfDiffView diff={content.diff} single />
    case 'text':
      if (markdown === 'rendered' && isMarkdownPath(path)) {
        return <RenderedMarkdown cwd={cwd} patch={content.patch} path={path} themeId={themeId} />
      }
      return (
        <PierreDiff
          ref={diffRef}
          cacheKey={cacheKey}
          diff={content.patch}
          path={path}
          themeId={themeId}
          view="single"
        />
      )
    case 'empty':
      return <Note>(empty file)</Note>
    case 'missing':
      return <Note>(not on disk)</Note>
    case 'binary':
      return <Note>{`(binary file — ${formatBytes(content.size)})`}</Note>
    case 'too-large':
      return (
        <Note>{`(file too large to show — ${formatBytes(content.size)}, limit ${formatBytes(content.limit)})`}</Note>
      )
  }
})

/** How long a path has to stay put before it is read. Under a key's repeat rate. */
const LOAD_DELAY_MS = 50

export const FileView = forwardRef<FileViewHandle, FileViewProps>(function FileView(
  { cwd, markdown = 'rendered', path, prefer = 'diff', revision = 0, themeId },
  ref
) {
  const slot = useMemo(() => createDiffScrollSlot(), [])
  const diffRef = useRef<PierreDiffHandle | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  const key =
    cwd !== null && path !== null ? `file-view:${cwd}:${path}:${prefer}:${revision}` : null

  useImperativeHandle(ref, () => ({ scroll: slot.scroll }), [slot])

  // The text renderers scroll their own boxes; a PDF or a rendered document
  // takes this over while it is drawn, and gives it back.
  useEffect(() => {
    slot.set((delta) => {
      const left = diffRef.current?.leftScroll
      if (!left) return
      const right = diffRef.current?.rightScroll
      const cap = Math.max(left.scrollHeight - left.viewport.height, 0)
      const next = Math.max(0, Math.min(cap, left.scrollTop + delta))
      left.scrollTop = next
      if (right && right !== left) right.scrollTop = next
    })
    return () => slot.set(null)
  }, [slot])

  useEffect(() => {
    if (key === null || cwd === null || path === null) return
    let cancelled = false
    void (async () => {
      // A cursor walking a tree with a key held lands on a new file every few
      // milliseconds. Only the one it stops on is worth the git processes, the
      // read and the highlighting.
      await Bun.sleep(LOAD_DELAY_MS)
      if (cancelled) return
      try {
        const content = await loadFileView(cwd, path, prefer)
        if (!cancelled) setLoaded({ content, key })
      } catch (error) {
        if (!cancelled) {
          setFailure({ key, message: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => {
      cancelled = true
      // What was parsed and highlighted for this file lives in git mode's cache;
      // a browser walking a repository would otherwise fill it with every file.
      dispatchGlobal({ key, type: 'git-mode-forget-diff' })
    }
  }, [cwd, key, path, prefer])

  let body: ReactNode
  if (key === null || cwd === null || path === null) body = <Note>Select a file.</Note>
  else if (failure?.key === key) body = <Note tone="error">{failure.message}</Note>
  else if (loaded?.key !== key) body = <Note>Loading…</Note>
  else {
    body = (
      <Content
        cacheKey={key}
        content={loaded.content}
        cwd={cwd}
        diffRef={diffRef}
        markdown={markdown}
        path={path}
        themeId={themeId}
      />
    )
  }

  return (
    <DiffScrollContext.Provider value={slot}>
      <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {body}
      </box>
    </DiffScrollContext.Provider>
  )
})
