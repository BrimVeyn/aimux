import type { ScrollBoxRenderable } from '@opentui/core'

import { definePlugin, type PluginNode, type UiPluginContext } from '@brimveyn/aimux-plugin'
import { useEffect, useRef } from 'react'

import {
  type Commit,
  type Failure,
  isFailure,
  type LogResult,
  relative,
  type ShowResult,
} from './parse'

/**
 * A view and not a pane: the history of a repository is a thing you go and
 * read, and while you are reading it the agent has nothing to say that the
 * commit list should be squeezed for.
 *
 * Two columns, half the width each — `flexBasis: 0` with equal grow, so the
 * split does not move when a subject is long — and both of them scrollboxes
 * rather than hand-cut windows. A view is handed no size, so anything counted
 * in rows here would be a guess; a scrollbox measures itself, and the cursor
 * is kept in sight with `scrollChildIntoView` rather than arithmetic.
 *
 * The right column is `--stat` and stops there: which files, how much each.
 * The hunks are git mode's screen, one `⏎` away, and a second diff viewer in
 * half a terminal would be a worse copy of it.
 */

interface Slice {
  branch: string | null
  commits: Commit[]
  selected: number
  /** `git show --stat` for `detailSha`: the body and one line per file. */
  detail: string | null
  detailSha: string | null
  truncated: boolean
  loading: boolean
  error: string | null
}

const EMPTY: Slice = {
  branch: null,
  commits: [],
  detail: null,
  detailSha: null,
  error: null,
  loading: false,
  selected: 0,
  truncated: false,
}

const keyOf = (item: unknown): string => (item as Commit).sha

function clamp(value: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(value, 0), length - 1)
}

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext<Slice>

    ctx.store.reducer((slice = EMPTY, action) => {
      switch (action.actionId) {
        case 'loading':
          return { ...slice, error: null, loading: true }
        case 'loaded': {
          const result = action.payload as LogResult
          return {
            ...slice,
            branch: result.branch,
            commits: result.commits,
            error: null,
            loading: false,
            selected: clamp(slice.selected, result.commits.length),
          }
        }
        case 'failed':
          return { ...EMPTY, error: action.payload as string }
        case 'move':
        case 'select': {
          const next =
            action.actionId === 'move'
              ? clamp(slice.selected + (action.payload as number), slice.commits.length)
              : clamp(action.payload as number, slice.commits.length)
          if (next === slice.selected) return slice
          // The old commit's diff must not sit under the new one's header.
          return { ...slice, detail: null, detailSha: null, selected: next }
        }
        case 'detail': {
          const result = action.payload as ShowResult
          // A late answer for a commit the user has already left.
          if (result.sha !== slice.commits[slice.selected]?.sha) return slice
          return {
            ...slice,
            detail: result.text,
            detailSha: result.sha,
            truncated: result.truncated,
          }
        }
        default:
          return slice
      }
    })

    const projectId = (): string | null => ctx.ui.state.get().projectId

    /** The file column's scrollbox, so a key can scroll something React drew. */
    let diffBox: ScrollBoxRenderable | null = null

    /**
     * The one call that is made in the background rather than for a screen the
     * user is waiting on, so it swallows its own failure: an RPC is a socket,
     * and a socket dies for reasons that have nothing to do with this plugin —
     * switching project destroys the backend and rejects everything in flight.
     * A log line is the right report for that; a toast per project switch is
     * not, and an escaping rejection is a stack trace over the interface.
     */
    const loadDetail = async (): Promise<void> => {
      const slice = ctx.store.get() ?? EMPTY
      const commit = slice.commits[slice.selected]
      if (commit === undefined) return
      try {
        const answer = await ctx.rpc.call<Failure | ShowResult>('show', {
          projectId: projectId(),
          sha: commit.sha,
        })
        if (isFailure(answer)) {
          ctx.log.warn('git show', { error: answer.error })
          return
        }
        ctx.store.dispatch('detail', answer)
      } catch (error) {
        ctx.log.warn('git show', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const refresh = async (): Promise<void> => {
      ctx.store.dispatch('loading')
      try {
        const answer = await ctx.rpc.call<Failure | LogResult>('log', { projectId: projectId() })
        if (isFailure(answer)) {
          ctx.store.dispatch('failed', answer.error)
          return
        }
        ctx.store.dispatch('loaded', answer)
        await loadDetail()
      } catch (error) {
        // The daemon half is not up: a plugin's other half is a process, and
        // saying so is better than an empty list that looks like an empty repo.
        ctx.store.dispatch('failed', error instanceof Error ? error.message : String(error))
      }
    }

    /** Half the visible height, so `^d` moves what a half-page key should. */
    const halfPage = (): number => Math.max(1, Math.floor((diffBox?.height ?? 20) / 2))

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

    bind(
      'open',
      async () => {
        ctx.ui.views.open('log')
        await refresh()
      },
      {
        description: "The repository's history, and the diff of the commit you are on",
        title: 'Git log',
      }
    )
    bind('close', () => {
      ctx.ui.views.close()
    })
    bind('refresh', refresh)
    // Awaited, not `void`ed: aimux contains what an effect throws, and a
    // promise started inside one and left behind escapes that containment.
    bind('down', async () => {
      ctx.store.dispatch('move', 1)
      await loadDetail()
    })
    bind('up', async () => {
      ctx.store.dispatch('move', -1)
      await loadDetail()
    })
    bind('detailDown', () => {
      diffBox?.scrollBy({ x: 0, y: halfPage() })
    })
    bind('detailUp', () => {
      diffBox?.scrollBy({ x: 0, y: -halfPage() })
    })

    /**
     * Hand the commit to aimux's own git mode.
     *
     * This one is an *action* and not an effect: it is three of aimux's own
     * state actions, and a plugin returning them is the whole point of the
     * envelope. An effect could not do it — nothing in `ctx.ui` moves git
     * mode's head, and nothing should.
     *
     * `headOffset` is `HEAD~N` and git mode diffs the working tree against it,
     * so the offset is the selected commit's *parent*: on the newest commit
     * that is exactly its diff, and further back it is everything since it.
     *
     * No `transition`: the mode follows `focusMode`, which these actions have
     * already moved. Asking for one as well would only be a transition out of
     * a plugin mode whose declared destination is `navigation`, refused and
     * logged for no gain.
     */
    ctx.actions.register(
      'inspect',
      () => {
        const slice = ctx.store.get() ?? EMPTY
        if (slice.commits.length === 0) return { actions: [], effects: [] }
        return {
          actions: [
            { type: 'close-plugin-view' },
            { type: 'enter-git-mode' },
            { offset: slice.selected + 1, type: 'git-mode-set-head-offset' },
          ],
          effects: [],
        }
      },
      {
        description: 'Leave for git mode, parked on the selected commit',
        title: 'Inspect in git mode',
      }
    )

    // ── The view ──────────────────────────────────────────────────────────

    /**
     * One `--stat` line: ` src/app.tsx | 12 ++++--------`.
     *
     * The bar is the only part with a colour to give, and it is two runs: git
     * writes every `+` before every `-`, so one split is the whole parse.
     */
    const STAT = /^(.*\|\s+\d+\s+)(\++)(-*)\s*$/

    function StatLine({ line }: { line: string }): PluginNode {
      const theme = ctx.ui.kit.useTheme()
      const match = STAT.exec(line)
      if (match === null) {
        // The summary line, a binary file, or a line of the commit body.
        return <text fg={line.startsWith(' ') ? theme.textMuted : theme.text}>{line}</text>
      }
      return (
        <text>
          <span fg={theme.text}>{match[1]}</span>
          <span fg={theme.success}>{match[2]}</span>
          <span fg={theme.error}>{match[3]}</span>
        </text>
      )
    }

    function Files({ slice }: { slice: Slice }): PluginNode {
      const { Row } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const ref = useRef<ScrollBoxRenderable | null>(null)
      const commit = slice.commits[slice.selected]

      // The keys scroll what the mouse scrolls, so the box outlives the render.
      useEffect(() => {
        diffBox = ref.current
        return () => {
          if (diffBox === ref.current) diffBox = null
        }
      })

      // A new commit starts at the top of its own file list, not where the
      // last one was left.
      useEffect(() => {
        ref.current?.scrollTo(0)
      }, [slice.detailSha])

      if (commit === undefined) return <text fg={theme.textMuted}>nothing selected</text>

      return (
        <box flexDirection="column" flexGrow={1} flexShrink={1}>
          {/* The short sha, not the long one: 40 characters do not fit half a
              terminal, and a wrapped value lands on the row under it. */}
          <Row label={commit.short} value={commit.date.slice(0, 10)} />
          <Row label={commit.author} value={relative(commit.date)} />
          <box flexShrink={0} paddingLeft={1} paddingRight={1}>
            <text fg={theme.text}>{commit.subject}</text>
          </box>
          <scrollbox
            ref={ref}
            scrollY
            flexGrow={1}
            flexShrink={1}
            contentOptions={{ flexDirection: 'column', gap: 0 }}
          >
            <box flexDirection="column" paddingLeft={1} paddingRight={1}>
              {slice.detail === null ? (
                <text fg={theme.textMuted}>reading…</text>
              ) : (
                slice.detail
                  .split('\n')
                  .map((line, index) => (
                    <StatLine key={`${slice.detailSha}:${index}`} line={line === '' ? ' ' : line} />
                  ))
              )}
              {slice.truncated ? <text fg={theme.warning}>list truncated</text> : null}
            </box>
          </scrollbox>
        </box>
      )
    }

    function Commits({ slice }: { slice: Slice }): PluginNode {
      const { List } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const ref = useRef<ScrollBoxRenderable | null>(null)
      const selectedSha = slice.commits[slice.selected]?.sha ?? null

      // The cursor moves by key, so the list has to follow it. By id rather
      // than by row height: a row is one line until the day it is not.
      useEffect(() => {
        if (selectedSha !== null) ref.current?.scrollChildIntoView(selectedSha)
      }, [selectedSha])

      if (slice.error !== null) return <text fg={theme.error}>{slice.error}</text>

      return (
        <scrollbox
          ref={ref}
          scrollY
          flexGrow={1}
          flexShrink={1}
          contentOptions={{ flexDirection: 'column', gap: 0 }}
        >
          <List
            items={slice.commits}
            keyOf={keyOf}
            selectedIndex={slice.selected}
            empty={<text fg={theme.textMuted}>{slice.loading ? 'reading…' : 'no commits'}</text>}
            onHover={(index) => {
              ctx.store.dispatch('select', index)
              // A mouse handler has no effect around it, so the catch inside
              // `loadDetail` is what keeps this one from escaping.
              void loadDetail()
            }}
            onSelect={(index) => {
              ctx.store.dispatch('select', index)
              void loadDetail()
            }}
            renderItem={(item, index) => {
              const commit = item as Commit
              return (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.accent}>{commit.short}</text>
                  <text fg={index === slice.selected ? theme.text : theme.textMuted}>
                    {commit.subject}
                  </text>
                </box>
              )
            }}
          />
        </scrollbox>
      )
    }

    function LogView(): PluginNode {
      const { KeyHint, Panel } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const slice = ctx.store.use() ?? EMPTY
      const title = slice.branch === null ? 'Commits' : `Commits — ${slice.branch}`
      const counter =
        slice.commits.length === 0 ? '' : ` ${slice.selected + 1}/${slice.commits.length}`

      return (
        <box flexDirection="column" flexGrow={1}>
          <box flexDirection="row" flexGrow={1} flexShrink={1}>
            <box flexBasis={0} flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
              <Panel title={title} flexGrow={1}>
                <Commits slice={slice} />
              </Panel>
            </box>
            <box flexBasis={0} flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
              <Panel title="Files" tone="muted" flexGrow={1}>
                <Files slice={slice} />
              </Panel>
            </box>
          </box>
          <box flexDirection="row" flexShrink={0}>
            <KeyHint
              hints={[
                { keys: 'j/k', label: 'move' },
                { keys: '⏎', label: 'diff' },
                { keys: '^d/^u', label: 'scroll' },
                { keys: 'r', label: 'reload' },
                { keys: 'q', label: 'close' },
              ]}
            />
            <text fg={theme.textMuted}>{counter}</text>
          </box>
        </box>
      )
    }

    ctx.ui.views.register({ id: 'log', render: () => <LogView />, title: 'Git log' })
  },
})
