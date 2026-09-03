import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_PLUGIN_RPC, IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import {
  PLUGIN_CONTROL_EVENT,
  PLUGIN_CONTROL_EVENTS_SUBSCRIBE,
  PLUGIN_CONTROL_ID,
} from '../../../plugins/rpc-envelope'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, EXIT_TIMEOUT, writeError, writeNdjson } from '../../output'

/**
 * The daemon's events, out of the process, as NDJSON.
 *
 * The fourteen events a daemon plugin subscribes to with `ctx.on` are the
 * published vocabulary; this hands the same stream to a shell script, a Go
 * binary, a phone relay — anything that can read a line of JSON. No SDK, and
 * nothing to keep in sync per language: the door every plugin in the
 * remote / mobile / telemetry family walks through.
 *
 * Attaches thin, so the daemon does not start rendering for it, then asks to
 * follow. One line per event: `{ event, at, payload }`.
 */

function matches(event: string, filter: string | null): boolean {
  if (filter === null || filter === '') return true
  if (filter.endsWith('*')) return event.startsWith(filter.slice(0, -1))
  return event === filter
}

export const eventsFollow: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    {
      complete: { kind: 'none' },
      description: 'only events matching this name; a trailing * matches a prefix (tab:*)',
      kind: 'string',
      name: 'filter',
    },
    { description: 'exit after N events', kind: 'number', name: 'count' },
    { description: 'exit after N milliseconds', kind: 'number', name: 'timeout' },
  ],
  group: 'events',
  run: async (ctx) => {
    const filter = typeof ctx.args.flags.filter === 'string' ? ctx.args.flags.filter : null
    const count = typeof ctx.args.flags.count === 'number' ? ctx.args.flags.count : 0
    const timeoutMs = typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : 0

    const project = ctx.getProject()
    const daemon = await ctx.getDaemon()
    if (
      !daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH) ||
      !daemon.hasCapability(IPC_CAPABILITY_PLUGIN_RPC)
    ) {
      writeError('the running daemon predates event streaming — restart aimux')
      return EXIT_RUNTIME
    }
    await daemon.attach({ cols: 0, projectId: project.id, rows: 0, thin: true })
    const response = await daemon.request('pluginRequest', {
      payload: {},
      pluginId: PLUGIN_CONTROL_ID,
      verb: PLUGIN_CONTROL_EVENTS_SUBSCRIBE,
    })
    if (response.type !== 'pluginResult') {
      writeError(
        response.type === 'error' ? response.payload.message : `unexpected ${response.type}`
      )
      return EXIT_RUNTIME
    }
    const start = Date.now()
    writeNdjson({ ts: 0, type: 'subscribed', ...(response.payload.result as object) })

    return new Promise<number>((resolve) => {
      let seen = 0
      const off = daemon.on('pluginEvent', (payload) => {
        if (payload.pluginId !== PLUGIN_CONTROL_ID || payload.verb !== PLUGIN_CONTROL_EVENT) return
        const body = payload.payload as { event?: string; at?: string; payload?: unknown }
        if (typeof body.event !== 'string' || !matches(body.event, filter)) return
        writeNdjson({
          at: body.at,
          event: body.event,
          payload: body.payload,
          ts: Date.now() - start,
          type: 'event',
        })
        seen += 1
        if (count > 0 && seen >= count) {
          cleanup()
          resolve(EXIT_OK)
        }
      })
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              writeNdjson({ ts: Date.now() - start, type: 'timeout' })
              cleanup()
              resolve(EXIT_TIMEOUT)
            }, timeoutMs)
          : null
      const cleanup = (): void => {
        off()
        if (timer) clearTimeout(timer)
      }
    })
  },
  summary: 'Stream the daemon’s events (tab:*, project:*, workspace:*) as NDJSON',
  verb: 'follow',
}
