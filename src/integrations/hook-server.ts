// Local HTTP server that receives assistant hook events. Bound to 127.0.0.1 on
// an OS-assigned port; each route's URL is injected into every PTY it belongs
// to, so a vendor's bridge script knows where to POST.
//
// It served exactly one path — `/hook/claude` — because there was exactly one
// vendor with hooks. The routing here is the same server with a table: Claude
// registers `claude` at boot and is otherwise unremarkable, which is the point.
// A plugin assistant registers its own and gets the same authority over the
// visual detector.

import { logDebug } from '../debug/input-log'

export interface HookEvent {
  paneId: string
  hookEventName: string
  /** Raw payload from the vendor, keyed by hook event. */
  payload: Record<string, unknown>
  receivedAt: number
  /** The route this arrived on — the assistant id. */
  source: string
}

export interface HookServer {
  /** The Claude route's URL. Kept for the sidecar file the shell bridge reads. */
  url: string
  /** URL for one route, or null when nothing has registered it. */
  urlFor: (source: string) => string | null
  /**
   * Registers a route. Returns the disposer the plugin's fiber holds; a
   * withdrawn route 404s again rather than silently accepting events nothing
   * will read.
   */
  route: (source: string, onEvent: (event: HookEvent) => void) => () => void
  stop: () => Promise<void>
}

/** `claude`, `acme.robot` — anything that can be a path segment. */
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9.-]*$/

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Starts the hook ingestion server. Throws if `Bun.serve` is unavailable (e.g.
 * running under plain Node). The daemon catches that and logs — detection falls
 * back to the visual PTY scanner.
 */
export function startHookServer(): HookServer {
  if (typeof Bun === 'undefined' || typeof Bun.serve !== 'function') {
    throw new Error('hook-server requires Bun.serve')
  }

  const routes = new Map<string, (event: HookEvent) => void>()

  const handle = Bun.serve({
    fetch: async (req) => {
      const url = new URL(req.url)
      const source = url.pathname.startsWith('/hook/') ? url.pathname.slice('/hook/'.length) : ''
      const onEvent = req.method === 'POST' ? routes.get(source) : undefined
      if (!onEvent) {
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
        onEvent({ hookEventName, paneId, payload: record, receivedAt: Date.now(), source })
      } catch (error) {
        // A handler that throws must not turn into a 500 the vendor's bridge
        // script retries: the event is already lost, and a retry storm on a
        // broken plugin would be worse than the missed status.
        logDebug('hookServer.dispatchError', {
          error: error instanceof Error ? error.message : String(error),
          hookEventName,
          paneId,
          source,
        })
      }
      return new Response('ok', { status: 200 })
    },
    hostname: '127.0.0.1',
    port: 0,
  })

  const origin = `http://127.0.0.1:${handle.port}`
  logDebug('hookServer.listening', { origin })

  return {
    route: (source, onEvent) => {
      if (!SOURCE_PATTERN.test(source)) {
        throw new Error(`hook route "${source}" must match ${String(SOURCE_PATTERN)}`)
      }
      routes.set(source, onEvent)
      logDebug('hookServer.route', { source })
      return () => {
        if (routes.get(source) === onEvent) routes.delete(source)
      }
    },
    stop: async () => {
      try {
        await handle.stop(true)
      } catch (error) {
        logDebug('hookServer.stopError', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    url: `${origin}/hook/claude`,
    urlFor: (source) => (routes.has(source) ? `${origin}/hook/${source}` : null),
  }
}
