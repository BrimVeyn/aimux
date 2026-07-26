import type { TerminalSnapshot } from '../../../state/types'
import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, EXIT_TIMEOUT, writeNdjson } from '../../output'
import { snapshotToLines } from '../../snapshot-render'

interface Cursor {
  row: number | null
  col: number | null
  visible: boolean
}

function toCursor(snapshot: TerminalSnapshot): Cursor {
  return {
    col: snapshot.cursorCol ?? null,
    row: snapshot.cursorRow ?? null,
    visible: snapshot.cursorVisible,
  }
}

export const tabTail: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'tab' }, name: 'tabId', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'emit the raw TerminalSnapshot instead of the trimmed text lines',
      kind: 'boolean',
      name: 'raw',
    },
    {
      description: 'coalesce renders arriving within N ms (default 0 = no coalescing)',
      kind: 'number',
      name: 'rate-limit-ms',
    },
    {
      description: 'also emit tabStatus records interleaved with renders',
      kind: 'boolean',
      name: 'follow-status',
    },
    {
      description: 'exit after N milliseconds even if the tab is still alive',
      kind: 'number',
      name: 'timeout',
    },
  ],
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }
    const raw = ctx.args.flags.raw === true
    const rateLimitMs =
      typeof ctx.args.flags['rate-limit-ms'] === 'number' ? ctx.args.flags['rate-limit-ms'] : 0
    const followStatus = ctx.args.flags['follow-status'] === true
    const timeoutMs = typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : 0

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }

    const start = Date.now()
    // Attach before wiring subscribers so replay renders arrive after we
    // print the "attached" marker; that keeps NDJSON output deterministic
    // for downstream consumers.
    const attach = await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })

    // Fail fast on a bad tabId — otherwise tail would sit silent until
    // --timeout, since no matching tabRender/tabExit would ever fire.
    if (!attach.tabs.some((t) => t.id === tabId)) {
      throw new Error(`tab not found: ${tabId}`)
    }

    return new Promise<number>((resolve) => {
      let lastEmitAt = 0
      let pendingViewport: TerminalSnapshot | null = null
      let coalesceTimer: ReturnType<typeof setTimeout> | null = null

      const emitRender = (viewport: TerminalSnapshot): void => {
        const ts = Date.now() - start
        if (raw) {
          writeNdjson({ tabId, ts, type: 'render', viewport })
        } else {
          writeNdjson({
            cursor: toCursor(viewport),
            lines: snapshotToLines(viewport, { trim: true }),
            tabId,
            ts,
            type: 'render',
          })
        }
        lastEmitAt = Date.now()
      }

      const scheduleCoalesced = (viewport: TerminalSnapshot): void => {
        pendingViewport = viewport
        if (coalesceTimer) return
        const elapsed = Date.now() - lastEmitAt
        const wait = Math.max(0, rateLimitMs - elapsed)
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null
          const v = pendingViewport
          pendingViewport = null
          if (v) emitRender(v)
        }, wait)
      }

      const offRender = daemon.on('tabRender', (payload) => {
        if (payload.tabId !== tabId) return
        if (rateLimitMs > 0) {
          scheduleCoalesced(payload.viewport)
        } else {
          emitRender(payload.viewport)
        }
      })
      const offExit = daemon.on('tabExit', (payload) => {
        if (payload.tabId !== tabId) return
        writeNdjson({ exitCode: payload.exitCode, tabId, ts: Date.now() - start, type: 'exit' })
        cleanup()
        resolve(EXIT_OK)
      })
      const offError = daemon.on('tabError', (payload) => {
        if (payload.tabId !== tabId) return
        writeNdjson({ error: payload.message, tabId, ts: Date.now() - start, type: 'error' })
        cleanup()
        resolve(EXIT_RUNTIME)
      })
      const noop = (): void => {}
      const offStatus = followStatus
        ? daemon.on('tabStatus', (payload) => {
            if (payload.tabId !== tabId) return
            writeNdjson({
              status: payload.status,
              tabId,
              ts: Date.now() - start,
              type: 'status',
            })
          })
        : noop

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              writeNdjson({ tabId, ts: Date.now() - start, type: 'timeout' })
              cleanup()
              resolve(EXIT_TIMEOUT)
            }, timeoutMs)
          : null

      const cleanup = (): void => {
        offRender()
        offExit()
        offError()
        offStatus()
        if (coalesceTimer) {
          clearTimeout(coalesceTimer)
          coalesceTimer = null
        }
        if (timer) clearTimeout(timer)
      }
    })
  },
  summary: 'Stream a tab’s render events as NDJSON',
  verb: 'tail',
}
