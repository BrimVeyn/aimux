import {
  definePlugin,
  type PluginFileViewController,
  type PluginNode,
  type UiPluginContext,
} from '@brimveyn/aimux-plugin'
import { createRef, useCallback, useMemo } from 'react'

import { EMPTY, reduce, rowsOf, type Slice, totals } from './state'
import { matchCount, type Row } from './tree'

/**
 * A read-only browser for the repository you are working in: the tree on the
 * left, the file under the cursor on the right.
 *
 * Nothing here draws a file. `kit.FileView` is git mode's own renderers — a
 * changed file split against HEAD, anything else drawn once with the same
 * highlighting, Markdown rendered, images and PDFs as pictures — so this
 * plugin is only the tree and the keys.
 *
 * Two tabs, as neo-tree has sources: Changes, the work, and Files, the whole
 * repository. The file follows the cursor, as git mode's diff does; `l` on a
 * file hands it the keys, to be read, and `h` hands them back.
 */

const SEARCH_GLYPH = '\u{2315}'

/** Lines `^d` and `^u` move the file by. */
const PAGE = 20

const keyOf = (item: unknown): string => (item as Row).key

const TREE_HINTS = [
  { keys: 'j/k', label: 'move' },
  { keys: 'l/h', label: 'open/close' },
  { keys: 'tab', label: 'changes/files' },
  { keys: '/', label: 'search' },
  { keys: '?', label: 'help' },
]

const FILE_HINTS = [
  { keys: 'j/k', label: 'scroll' },
  { keys: '^d/^u', label: 'page' },
  { keys: 'h', label: 'back' },
  { keys: 's', label: 'diff/file' },
  { keys: '?', label: 'help' },
]

function emptyText(slice: Slice): string {
  if (slice.loading) return 'reading…'
  if (slice.filter !== '') return 'no match'
  return slice.tab === 'changes' ? 'nothing changed' : 'no files'
}

/** The letter a changed file is marked with, and the colour it gets. */
function mark(status: string | null): { glyph: string; tone: string } | null {
  switch (status) {
    case null:
      return null
    case '?':
    case 'A':
      return { glyph: status === '?' ? 'U' : 'A', tone: 'success' }
    case 'D':
      return { glyph: 'D', tone: 'error' }
    default:
      return { glyph: status, tone: 'warning' }
  }
}

/** `name` cut where the search matched, so the matched characters can be coloured. */
function pieces(name: string, match: readonly number[]): { hit: boolean; text: string }[] {
  if (match.length === 0) return [{ hit: false, text: name }]
  const hits = new Set(match)
  const out: { hit: boolean; text: string }[] = []
  for (let i = 0; i < name.length; i++) {
    const hit = hits.has(i)
    const tail = out.at(-1)
    if (tail?.hit === hit) tail.text += name[i]
    else out.push({ hit, text: name[i] as string })
  }
  return out
}

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext<Slice>
    // Nerd Font glyphs need a Nerd Font; without one they are boxes, and the
    // fold arrows say the same thing in any font.
    const icons = ctx.config.icons !== false
    ctx.store.reducer(reduce)
    const slice = (): Slice => ctx.store.get() ?? EMPTY

    /** The file view on screen, while there is one. */
    const viewer = createRef<PluginFileViewController>()

    const reload = async (): Promise<void> => {
      ctx.store.dispatch('loading')
      try {
        ctx.store.dispatch('loaded', await ctx.ui.git.files())
      } catch (error) {
        ctx.store.dispatch('failed', error instanceof Error ? error.message : String(error))
      }
    }

    /** An action and the effect it fires — the two halves of every binding. */
    const bind = (
      verb: string,
      run: () => void | Promise<void>,
      meta?: { title: string; description: string }
    ): void => {
      ctx.actions.effect(verb, run)
      ctx.actions.register(
        verb,
        () => ({
          actions: [],
          effects: [{ effectId: verb, pluginId: ctx.id, type: 'plugin-effect' }],
        }),
        meta
      )
    }

    /** A key that moves the cursor in the tree, and scrolls the file while it has the keys. */
    const walk = (verb: string, lines: number): void =>
      bind(verb, () => {
        if (slice().focus === 'file') viewer.current?.scroll(lines)
        else ctx.store.dispatch('move', Math.sign(lines))
      })

    bind(
      'open',
      async () => {
        ctx.ui.views.open('explorer')
        await reload()
      },
      {
        description: 'Every file of the repository, read-only, changed ones as a diff',
        title: 'Explorer',
      }
    )
    // Esc steps back one thing at a time: out of the file, out of a search,
    // out of the explorer.
    bind('back', () => {
      const now = slice()
      if (now.focus === 'file') ctx.store.dispatch('focus', 'tree')
      else if (now.filter !== '') ctx.store.dispatch('filter', '')
      else ctx.ui.views.close()
    })
    bind('quit', () => ctx.ui.views.close())
    bind('search', () => {
      const before = slice().filter
      ctx.store.dispatch('focus', 'tree')
      ctx.ui.input.open({
        initial: before,
        onCancel: () => ctx.store.dispatch('filter', before),
        onChange: (text) => ctx.store.dispatch('filter', text),
        onSubmit: (text) => ctx.store.dispatch('filter', text),
      })
    })
    // The keybinding overlay, scoped to this view's keys — every binding the
    // manifest declares, with its description.
    ctx.actions.register('help', () => ({
      actions: [{ scope: `plugin.${ctx.id}.explorer`, type: 'open-help-modal' }],
      effects: [],
    }))
    walk('down', 1)
    walk('up', -1)
    bind('enter', () => ctx.store.dispatch('open'))
    bind('collapse', () => {
      if (slice().focus === 'file') ctx.store.dispatch('focus', 'tree')
      else ctx.store.dispatch('close')
    })
    bind('parent', () => ctx.store.dispatch('parent'))
    bind('closeParent', () => ctx.store.dispatch('parent', 'close'))
    bind('firstSibling', () => ctx.store.dispatch('sibling', -1))
    bind('lastSibling', () => ctx.store.dispatch('sibling', 1))
    bind('top', () => ctx.store.dispatch('edge', -1))
    bind('bottom', () => ctx.store.dispatch('edge', 1))
    bind('switchTab', () => ctx.store.dispatch('tab'))
    bind('collapseAll', () => ctx.store.dispatch('collapseAll'))
    bind('expandAll', () => ctx.store.dispatch('expandAll'))
    bind('reload', reload)
    bind('nextChange', () => ctx.store.dispatch('jump', 1))
    bind('previousChange', () => ctx.store.dispatch('jump', -1))
    bind('toggleDiff', () => ctx.store.dispatch('prefer'))
    bind('toggleMarkdown', () => ctx.store.dispatch('markdown'))
    bind('scrollDown', () => viewer.current?.scroll(1))
    bind('scrollUp', () => viewer.current?.scroll(-1))
    bind('pageDown', () => viewer.current?.scroll(PAGE))
    bind('pageUp', () => viewer.current?.scroll(-PAGE))

    const onSelect = (index: number): void => ctx.store.dispatch('click', index)

    // ── The view ──────────────────────────────────────────────────────────

    function TreeRow({ row, selected }: { row: Row; selected: boolean }): PluginNode {
      const theme = ctx.ui.kit.useTheme()
      // Changed things read as text, untouched ones recede. On the selected row
      // everything takes the selection's ink: a status colour on top of the
      // list's fill would be unreadable.
      const tone = (name: string): string | undefined =>
        selected ? theme.selectionInk : theme[name]
      const changed = row.kind === 'dir' ? row.changed : row.status !== null
      const ink = tone(changed ? 'text' : 'textMuted')
      const guide = <span fg={tone('textMuted')}>{row.guide}</span>
      if (row.kind === 'dir') {
        if (!icons) {
          return (
            <text fg={ink} wrapMode="none">
              {guide}
              {`${row.open ? '▾' : '▸'} ${row.name}/`}
            </text>
          )
        }
        // An open folder's glyph is an open folder: no arrow beside it, as
        // nvim-tree and oil draw them.
        const folder = ctx.ui.kit.folderIcon(row.open)
        return (
          <text fg={ink} wrapMode="none">
            {guide}
            <span fg={tone(folder.tone)}>{`${folder.glyph} `}</span>
            {row.name}
          </text>
        )
      }
      const m = mark(row.status)
      const glyph = icons ? ctx.ui.kit.fileIcon(row.path) : null
      return (
        <box flexDirection="row" flexGrow={1}>
          <box flexGrow={1} flexShrink={1} overflow="hidden">
            <text fg={ink} wrapMode="none">
              {guide}
              {glyph === null ? null : <span fg={tone(glyph.tone)}>{`${glyph.glyph} `}</span>}
              {pieces(row.name, row.match).map((piece, i) =>
                piece.hit ? (
                  // oxlint-disable-next-line no-array-index-key -- pieces have no identity but their place
                  <span key={i} fg={tone('primary')}>
                    {piece.text}
                  </span>
                ) : (
                  piece.text
                )
              )}
              {m === null ? null : <span fg={tone(m.tone)}>{` ${m.glyph}`}</span>}
            </text>
          </box>
          <Counts added={row.added} removed={row.removed} tone={tone} />
        </box>
      )
    }

    /** `+12 -3`, as git mode's sidebar has it. Nothing for a file git did not count. */
    function Counts({
      added,
      removed,
      tone,
    }: {
      added: number | null
      removed: number | null
      tone: (name: string) => string | undefined
    }): PluginNode {
      if (added === null && removed === null) return null
      return (
        <text flexShrink={0} wrapMode="none">
          {added === null ? null : <span fg={tone('success')}>{` +${added}`}</span>}
          {removed === null ? null : <span fg={tone('error')}>{` -${removed}`}</span>}
        </text>
      )
    }

    /** Which tab is up, and what each holds. The one place the counts are said. */
    function Tabs({ slice: now }: { slice: Slice }): PluginNode {
      const theme = ctx.ui.kit.useTheme()
      const changed = useMemo(
        () => now.files.filter((file) => file.status !== null).length,
        [now.files]
      )
      const sum = useMemo(() => totals(now.files), [now.files])
      const ink = (tab: Slice['tab']): string | undefined =>
        now.tab === tab ? theme.text : theme.textMuted
      return (
        <box flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1}>
          <text wrapMode="none" flexGrow={1}>
            <span fg={ink('changes')}>{`Changes ${changed}`}</span>
            <span fg={theme.textMuted}>{' · '}</span>
            <span fg={ink('files')}>{`Files ${now.files.length}`}</span>
          </text>
          <text wrapMode="none" flexShrink={0}>
            {sum.added > 0 ? <span fg={theme.success}>{`+${sum.added}`}</span> : null}
            {sum.removed > 0 ? <span fg={theme.error}>{` -${sum.removed}`}</span> : null}
          </text>
        </box>
      )
    }

    /** The search line: drawn while one is typed or applied, like git mode's. */
    function SearchBar({ slice: now }: { slice: Slice }): PluginNode {
      const { TextField } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const field = ctx.ui.input.use()
      const matched = useMemo(() => (now.filter === '' ? 0 : matchCount(now.files, now)), [now])
      if (field === null && now.filter === '') return null
      return (
        <box
          flexShrink={0}
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.backgroundElement}
        >
          <text fg={theme.primary} wrapMode="none">{`${SEARCH_GLYPH} `}</text>
          <box flexGrow={1} flexShrink={1} overflow="hidden">
            {field === null ? (
              <text fg={theme.text} wrapMode="none">
                {now.filter}
              </text>
            ) : (
              <TextField cursor={field.cursor} placeholder="Fuzzy search…" value={field.value} />
            )}
          </box>
          <text fg={theme.textMuted} wrapMode="none">{` ${matched}`}</text>
        </box>
      )
    }

    function Tree({ slice: now }: { slice: Slice }): PluginNode {
      const { VirtualList } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const { at, rows } = rowsOf(now)
      const renderItem = useCallback(
        (item: unknown, _index: number, selected: boolean) => (
          <TreeRow row={item as Row} selected={selected} />
        ),
        []
      )
      if (now.error !== null) return <text fg={theme.error}>{now.error}</text>
      return (
        <VirtualList
          items={rows}
          keyOf={keyOf}
          selectedIndex={at}
          focused={now.focus === 'tree'}
          empty={<text fg={theme.textMuted}>{emptyText(now)}</text>}
          onSelect={onSelect}
          renderItem={renderItem}
        />
      )
    }

    function ExplorerView(): PluginNode {
      const { FileView, KeyHint } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const now = ctx.store.use() ?? EMPTY
      const status = useMemo(
        () => now.files.find((file) => file.path === now.opened)?.status ?? null,
        [now.files, now.opened]
      )

      // What the right side is showing, when it is not just the file.
      let what = ''
      if (now.opened !== null && status === '?') what = 'untracked'
      else if (now.opened !== null && status !== null) {
        what = now.prefer === 'diff' ? 'changed · against HEAD' : 'changed · as on disk'
      }

      return (
        <box flexDirection="column" flexGrow={1}>
          <box flexDirection="row" flexGrow={1} flexShrink={1}>
            <box
              width="30%"
              minWidth={24}
              flexShrink={0}
              flexDirection="column"
              overflow="hidden"
              backgroundColor={theme.backgroundPanel}
            >
              <Tabs slice={now} />
              <SearchBar slice={now} />
              <Tree slice={now} />
            </box>
            <box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
              <box flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1}>
                <text fg={theme.text}>{now.opened ?? ''}</text>
                <text fg={theme.textMuted}>{what === '' ? '' : `  ${what}`}</text>
              </box>
              <FileView
                controller={viewer}
                markdown={now.markdown}
                path={now.opened}
                prefer={now.prefer}
                revision={now.revision}
              />
            </box>
          </box>
          <box flexShrink={0} backgroundColor={theme.backgroundPanel}>
            <KeyHint hints={now.focus === 'file' ? FILE_HINTS : TREE_HINTS} />
          </box>
        </box>
      )
    }

    ctx.ui.views.register({ id: 'explorer', render: () => <ExplorerView />, title: 'Explorer' })
  },
})
