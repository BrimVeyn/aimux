import {
  definePlugin,
  type PluginCommandEntry,
  type PluginNode,
  type UiPluginContext,
} from '@brimveyn/aimux-plugin'

/**
 * A palette is a `List` over `ctx.commands.list()` and a call to
 * `ctx.commands.run`. That is the whole plugin; the rest of this file is the
 * entries it contributes so the list is worth opening on a fresh install.
 *
 * Three kinds land in one list and never knew about each other: actions with
 * a title, manifest `commands[]`, CLI verbs. Only an action runs from here —
 * the other two are subprocesses the daemon runs, and the palette says how to
 * reach them instead of pretending to.
 */

interface Slice {
  entries: PluginCommandEntry[]
  selected: number
  /** What was last run, for the footer. Cleared on refresh. */
  lastRun: string | null
}

const EMPTY: Slice = { entries: [], lastRun: null, selected: 0 }

const GLYPH: Record<PluginCommandEntry['kind'], string> = { action: '▸', cli: '$', exec: '⚙' }

const HINTS = [
  { keys: 'j/k', label: 'move' },
  { keys: '⏎', label: 'run' },
  { keys: 'r', label: 'refresh' },
  { keys: 'q', label: 'close' },
] as const

const keyOf = (item: unknown): string => (item as PluginCommandEntry).id

function clamp(index: number, length: number): number {
  if (length === 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

/** Actions first — they are the ones that run from here — then by title. */
function sorted(entries: readonly PluginCommandEntry[]): PluginCommandEntry[] {
  return [...entries].sort((a, b) => {
    if ((a.kind === 'action') !== (b.kind === 'action')) return a.kind === 'action' ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext<Slice>

    ctx.store.reducer((slice = EMPTY, action) => {
      switch (action.actionId) {
        case 'loaded': {
          const entries = sorted(action.payload as PluginCommandEntry[])
          return { entries, lastRun: null, selected: clamp(slice.selected, entries.length) }
        }
        case 'move':
          return {
            ...slice,
            selected: clamp(slice.selected + (action.payload as number), slice.entries.length),
          }
        case 'select':
          return { ...slice, selected: clamp(action.payload as number, slice.entries.length) }
        case 'ran':
          return { ...slice, lastRun: action.payload as string }
        default:
          return slice
      }
    })

    const refresh = (): void => {
      // Not the plugin's own entries — every plugin's. Filtering itself out
      // would hide the one row a first-time user can safely try.
      ctx.store.dispatch('loaded', ctx.commands.list())
    }

    const runAt = (index: number): void => {
      const entry = ctx.store.get()?.entries[index]
      if (!entry) return
      if (entry.kind !== 'action') {
        // A subprocess is the daemon's to run, and the CLI is the door.
        ctx.ui.toast.info(`aimux ${entry.id}`)
        ctx.store.dispatch('ran', `aimux ${entry.id}`)
        return
      }
      const answered = ctx.commands.run(entry.id)
      ctx.store.dispatch('ran', answered ? entry.title : `${entry.title}: nothing answered`)
      if (!answered) ctx.ui.toast.error(`palette: ${entry.id} did not answer`)
    }

    // ── The palette's own keys ────────────────────────────────────────────

    const effect = (verb: string, run: () => void | Promise<void>): void => {
      ctx.actions.effect(verb, run)
      ctx.actions.register(verb, () => ({
        actions: [],
        effects: [{ effectId: verb, pluginId: ctx.id, type: 'plugin-effect' }],
      }))
    }

    effect('down', () => {
      ctx.store.dispatch('move', 1)
    })
    effect('up', () => {
      ctx.store.dispatch('move', -1)
    })
    effect('refresh', refresh)
    effect('run', () => {
      runAt(ctx.store.get()?.selected ?? 0)
    })
    effect('close', () => {
      ctx.ui.panes.close('commands')
    })

    ctx.actions.effect('open', () => {
      refresh()
      ctx.ui.panes.open('commands', 'vertical')
    })
    ctx.actions.register(
      'open',
      () => ({
        actions: [],
        effects: [{ effectId: 'open', pluginId: ctx.id, type: 'plugin-effect' }],
      }),
      {
        description: 'Every runnable thing plugins contributed, in one list',
        title: 'Command palette',
      }
    )

    // ── Entries worth having on a fresh install ────────────────────────────
    //
    // Layout verbs the keyboard already has, and two git verbs, each with a
    // title. Without one an action lists under its verb, which is a name for
    // the author and not for the person reading the palette.

    const contribute = (
      verb: string,
      title: string,
      description: string,
      run: () => void | Promise<void>
    ): void => {
      ctx.actions.effect(verb, run)
      ctx.actions.register(
        verb,
        () => ({
          actions: [],
          effects: [{ effectId: verb, pluginId: ctx.id, type: 'plugin-effect' }],
        }),
        { description, title }
      )
    }

    contribute('split-right', 'Split right', 'A new terminal beside this one', () => {
      ctx.ui.layout.split('vertical')
    })
    contribute('split-down', 'Split down', 'A new terminal under this one', () => {
      ctx.ui.layout.split('horizontal')
    })
    contribute('swap-left', 'Swap with the pane on the left', 'Exchanges the two panes', () => {
      ctx.ui.layout.swap('left')
    })
    contribute('swap-right', 'Swap with the pane on the right', 'Exchanges the two panes', () => {
      ctx.ui.layout.swap('right')
    })
    contribute(
      'stage-all',
      'Stage every change',
      '`git add` on what the git panel lists',
      async () => {
        const paths = ctx.ui.git
          .status()
          .files.filter((file) => file.section !== 'staged')
          .map((file) => file.path)
        if (paths.length === 0) {
          ctx.ui.toast.info('nothing to stage')
          return
        }
        try {
          await ctx.ui.git.stage(paths)
          ctx.ui.toast.success(`staged ${paths.length} file${paths.length === 1 ? '' : 's'}`)
        } catch (error) {
          ctx.ui.toast.error(error instanceof Error ? error.message : String(error))
        }
      }
    )
    contribute(
      'unstage-all',
      'Unstage everything',
      '`git restore --staged` on the index',
      async () => {
        const paths = ctx.ui.git
          .status()
          .files.filter((file) => file.section === 'staged')
          .map((file) => file.path)
        if (paths.length === 0) {
          ctx.ui.toast.info('nothing staged')
          return
        }
        try {
          await ctx.ui.git.unstage(paths)
          ctx.ui.toast.success(`unstaged ${paths.length} file${paths.length === 1 ? '' : 's'}`)
        } catch (error) {
          ctx.ui.toast.error(error instanceof Error ? error.message : String(error))
        }
      }
    )

    // ── The pane ──────────────────────────────────────────────────────────

    function Palette(): PluginNode {
      const { KeyHint, List } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const slice = ctx.store.use() ?? EMPTY

      return (
        <box flexDirection="column" flexGrow={1}>
          <box flexGrow={1}>
            <List
              items={slice.entries}
              selectedIndex={slice.selected}
              keyOf={keyOf}
              empty={<text fg={theme.textMuted}>nothing registered a title yet</text>}
              onHover={(index) => {
                ctx.store.dispatch('select', index)
              }}
              onSelect={runAt}
              renderItem={(item, index) => {
                const entry = item as PluginCommandEntry
                const active = index === slice.selected
                return (
                  <box flexDirection="row" gap={1}>
                    <text fg={entry.kind === 'action' ? theme.accent : theme.textMuted}>
                      {GLYPH[entry.kind]}
                    </text>
                    <text fg={active ? theme.text : theme.textMuted}>{entry.title}</text>
                    <text fg={theme.textMuted}>{entry.pluginId}</text>
                  </box>
                )
              }}
            />
          </box>
          {slice.lastRun === null ? null : (
            <text fg={theme.textMuted}>{`ran: ${slice.lastRun}`}</text>
          )}
          <KeyHint hints={HINTS} />
        </box>
      )
    }

    ctx.ui.panes.register({ id: 'commands', render: () => <Palette />, title: 'Commands' })
  },
})
