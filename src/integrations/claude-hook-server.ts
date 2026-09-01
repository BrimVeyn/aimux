// Local HTTP server that receives Claude Code hook events from the shipped
// shell bridge (assets/claude-hooks/aimux-agent-state.sh). Bound to 127.0.0.1
// on an OS-assigned port; the URL is injected into each PTY via
// `AIMUX_HOOK_URL` so the bridge knows where to POST.
//
// The body is the Claude hook payload (see https://code.claude.com/docs/en/hooks.md)
// augmented with `aimuxPaneId` by the shell bridge. We forward minimal info
// to the daemon's status loop, which performs the actual hook → activity
// mapping in assistant-status-arbiter.

import { logDebug } from '../debug/input-log'

export interface ClaudeHookEvent {
  paneId: string
  hookEventName: string
  /** Raw payload from Claude, keyed by hook event. */
  payload: Record<string, unknown>
  receivedAt: number
}

export interface ClaudeHookServer {
  url: string
  stop: () => Promise<void>
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Start the hook ingestion server. Throws if Bun.serve is unavailable (e.g.
 * running under plain Node). The daemon catches that and logs — detection
 * falls back to the visual PTY scanner.
 */
export function startClaudeHookServer(options: {
  onEvent: (event: ClaudeHookEvent) => void
}): ClaudeHookServer {
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('claude-hook-server requires Bun.serve')
  }

  const handle = Bun.serve({
    fetch: async (req) => {
      const url = new URL(req.url)
      if (req.method !== 'POST' || url.pathname !== '/hook/claude') {
        return new Response('Not Found', { status: 404 })
      }
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return new Response('Bad JSON', { status: 400 })
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return new Response('Body must be an object', { status: 400 })
      }
      const record = body as Record<string, unknown>
      const paneId = pickString(record.aimuxPaneId)
      const hookEventName = pickString(record.hook_event_name)
      if (paneId === '' || hookEventName === '') {
        return new Response('Missing aimuxPaneId or hook_event_name', { status: 400 })
      }
      try {
        options.onEvent({
          hookEventName,
          paneId,
          payload: record,
          receivedAt: Date.now(),
        })
      } catch (error) {
        logDebug('claudeHookServer.dispatchError', {
          error: error instanceof Error ? error.message : String(error),
          hookEventName,
          paneId,
        })
      }
      return new Response('ok', { status: 200 })
    },
    hostname: '127.0.0.1',
    port: 0,
  })

  const port = handle.port
  const url = `http://127.0.0.1:${port}/hook/claude`
  logDebug('claudeHookServer.listening', { url })

  return {
    stop: async () => {
      try {
        await handle.stop(true)
      } catch (error) {
        logDebug('claudeHookServer.stopError', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    url,
  }
}
