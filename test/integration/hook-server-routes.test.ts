import { afterEach, describe, expect, test } from 'bun:test'

import {
  type HookEvent,
  type HookServer,
  startHookServer,
} from '../../src/integrations/hook-server'
import { clearAssistants, registerAssistant } from '../../src/pty/assistant-registry'
import { AssistantStatusArbiter } from '../../src/pty/assistant-status-arbiter'

/**
 * The hook server used to serve exactly one path, because there was exactly
 * one vendor with hooks. Routing it is the same server with a table: Claude
 * registers `claude` at boot and is otherwise unremarkable, which is what makes
 * a plugin's route the same mechanism rather than a parallel one.
 */

let server: HookServer | null = null

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

afterEach(async () => {
  await server?.stop()
  server = null
  clearAssistants()
})

describe('hook server routes', () => {
  test('an unregistered route 404s', async () => {
    server = startHookServer()
    const response = await post(`${server.url.replace('/hook/claude', '')}/hook/acme.robot`, {
      aimuxPaneId: 't1',
      hook_event_name: 'Stop',
    })
    expect(response.status).toBe(404)
    expect(server.urlFor('acme.robot')).toBeNull()
  })

  test('a registered route receives the event, tagged with its source', async () => {
    server = startHookServer()
    const seen: HookEvent[] = []
    server.route('acme.robot', (event) => seen.push(event))

    const url = server.urlFor('acme.robot')
    expect(url).not.toBeNull()
    if (url === null) return

    const response = await post(url, {
      aimuxPaneId: 'tab-7',
      extra: 'passed through',
      hook_event_name: 'TurnEnded',
    })

    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.paneId).toBe('tab-7')
    expect(seen[0]?.hookEventName).toBe('TurnEnded')
    expect(seen[0]?.source).toBe('acme.robot')
    // The payload is handed over whole — the vendor's vocabulary is not ours
    // to trim.
    expect(seen[0]?.payload.extra).toBe('passed through')
  })

  test('routes are kept apart', async () => {
    server = startHookServer()
    const claude: HookEvent[] = []
    const robot: HookEvent[] = []
    server.route('claude', (event) => claude.push(event))
    server.route('acme.robot', (event) => robot.push(event))

    const url = server.urlFor('acme.robot')
    if (url === null) return
    await post(url, { aimuxPaneId: 't1', hook_event_name: 'Stop' })

    expect(claude).toEqual([])
    expect(robot).toHaveLength(1)
  })

  test('a withdrawn route 404s again', async () => {
    server = startHookServer()
    const dispose = server.route('acme.robot', () => {})
    const url = server.urlFor('acme.robot')
    if (url === null) return

    expect((await post(url, { aimuxPaneId: 't1', hook_event_name: 'Stop' })).status).toBe(200)
    dispose()
    // Silently accepting events nothing will read would be worse than a 404
    // the bridge script can report.
    expect((await post(url, { aimuxPaneId: 't1', hook_event_name: 'Stop' })).status).toBe(404)
  })

  test('a malformed body is rejected without reaching the handler', async () => {
    server = startHookServer()
    const seen: HookEvent[] = []
    server.route('acme.robot', (event) => seen.push(event))
    const url = server.urlFor('acme.robot')
    if (url === null) return

    expect((await post(url, { hook_event_name: 'Stop' })).status).toBe(400)
    expect((await post(url, { aimuxPaneId: 't1' })).status).toBe(400)
    expect(seen).toEqual([])
  })

  test('a throwing handler still answers 200', async () => {
    server = startHookServer()
    server.route('acme.robot', () => {
      throw new Error('plugin blew up')
    })
    const url = server.urlFor('acme.robot')
    if (url === null) return

    // The event is already lost; a 500 would only earn a retry storm from the
    // vendor's bridge script.
    expect((await post(url, { aimuxPaneId: 't1', hook_event_name: 'Stop' })).status).toBe(200)
  })

  test('a route id that cannot be a path segment is refused', () => {
    server = startHookServer()
    expect(() => server?.route('Acme Robot/../etc', () => {})).toThrow()
  })
})

describe('arbiter with N sources', () => {
  const NOW = 1_000_000

  test("a plugin assistant's mapping is used for its own source", () => {
    registerAssistant({
      hooks: {
        mapEvent: (name) => (name === 'TurnEnded' ? 'idle' : 'working'),
        urlEnvVar: 'ACME_HOOK_URL',
      },
      option: { command: 'acme-robot', description: '', id: 'acme.robot', label: 'Acme' },
    })

    const arbiter = new AssistantStatusArbiter()
    expect(
      arbiter.recordHookEvent({
        hookEventName: 'TurnEnded',
        paneId: 't1',
        payload: {},
        receivedAt: NOW,
        source: 'acme.robot',
      })
    ).toBe('idle')
    // Fresh hook outranks the visual reading, exactly as Claude's does.
    expect(arbiter.arbitrate('t1', 'working', NOW + 100)).toBe('idle')
  })

  test('an unknown source maps nothing rather than borrowing Claude s vocabulary', () => {
    const arbiter = new AssistantStatusArbiter()
    // Applying Claude's event names to another vendor would map most to null
    // and the rest wrongly, which is worse than having no hook signal.
    expect(
      arbiter.recordHookEvent({
        hookEventName: 'Stop',
        paneId: 't1',
        payload: {},
        receivedAt: NOW,
        source: 'acme.unknown',
      })
    ).toBeNull()
    expect(arbiter.arbitrate('t1', 'working', NOW + 100)).toBe('working')
  })

  test('an absent source is still Claude, the only one that predates routing', () => {
    const arbiter = new AssistantStatusArbiter()
    expect(
      arbiter.recordHookEvent({
        hookEventName: 'Stop',
        paneId: 't1',
        payload: {},
        receivedAt: NOW,
      })
    ).toBe('idle')
  })

  test('a visible permission prompt still beats a fresh hook, whatever the source', () => {
    registerAssistant({
      hooks: { mapEvent: () => 'working', urlEnvVar: 'ACME_HOOK_URL' },
      option: { command: 'acme-robot', description: '', id: 'acme.robot', label: 'Acme' },
    })
    const arbiter = new AssistantStatusArbiter()
    arbiter.recordHookEvent({
      hookEventName: 'ToolStarted',
      paneId: 't1',
      payload: {},
      receivedAt: NOW,
      source: 'acme.robot',
    })
    // Some prompts fire no hook at all, and the screen is the only place they
    // show. That rule is about what each side can see, not about whose events
    // these are.
    expect(arbiter.arbitrate('t1', 'waiting-input', NOW + 100)).toBe('waiting-input')
  })
})
