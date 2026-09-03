import { clearPluginActions, getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { createTestContext } from '@brimveyn/aimux-plugin'
import { afterEach, expect, test } from 'bun:test'

import type { KeyInput } from '../../src/input/modes/types'
import type { AppAction } from '../../src/state/actions'

import { setActiveKeymap } from '../../src/input/keymap/keymap-ref'
import { registerAllModes } from '../../src/input/modes/handlers'
import { getHandler } from '../../src/input/modes/registry'
import { parseManifest } from '../../src/plugins/manifest'
import { setActiveDispatch } from '../../src/state/dispatch-ref'
import { createInitialState } from '../../src/state/store'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'

/**
 * The manifest's `contributes` block, from JSON to a placed widget and a live
 * keybinding.
 *
 * This is the phase-8 promise in one test: a plugin that declares where its
 * widget goes and which key runs its action needs no `aimux.config.ts` edit and
 * no restart — and an unload takes both back.
 */

const keymap = getDefaultKeymapConfig()
setActiveKeymap(keymap)
registerAllModes(keymap)

function manifestWith(contributes: unknown): Record<string, unknown> {
  return {
    apiVersion: 1,
    contributes,
    entries: { ui: 'src/ui.tsx' },
    id: 'acme.thing',
    version: '1.0.0',
  }
}

async function captured(run: () => Promise<unknown>): Promise<AppAction[]> {
  const actions: AppAction[] = []
  setActiveDispatch((action) => actions.push(action))
  try {
    await run()
  } finally {
    setActiveDispatch(null)
  }
  return actions
}

function key(name: string, opts: { ctrl?: boolean } = {}): KeyInput {
  return { ctrl: opts.ctrl ?? false, meta: false, name, sequence: name, shift: false }
}

/** The shipped leader is `<C-w>`, so a `<leader>x` sequence is two presses. */
function pressLeaderThen(mode: string, name: string): unknown {
  const handler = getHandler(mode as Parameters<typeof getHandler>[0])
  if (!handler) throw new Error(`no handler for ${mode}`)
  const ctx = { state: createInitialState({}, [], [], false) }
  handler.handleKey(key('w', { ctrl: true }), ctx)
  return handler.handleKey(key(name), ctx)
}

afterEach(() => {
  clearPluginActions()
})

test('a manifest places its widget and binds its key, and an unload undoes both', async () => {
  const parsed = parseManifest(
    manifestWith({
      bars: [{ grow: 30, position: 'start', side: 'right', widget: 'load' }],
      keymaps: [{ action: 'open', key: '<leader>%', mode: 'navigation' }],
    })
  )
  if (!parsed.ok) throw new Error(`manifest rejected: ${JSON.stringify(parsed.issues)}`)

  // The contributions are applied while the context is being extended — the
  // same moment the real host does it, before the plugin's own `apply` runs —
  // so the capture has to wrap the construction, not the apply.
  let harness!: ReturnType<typeof createTestContext>
  const placed = await captured(async () => {
    harness = createTestContext({
      extend: extendUiPluginContext,
      host: 'ui',
      id: 'acme.thing',
      manifest: parsed.manifest,
    })
    return harness.apply({
      apply: () => {
        /* the contributions are the manifest's, not this plugin's code */
      },
    })
  })

  expect(placed).toEqual([
    {
      grow: 30,
      index: 0,
      placedBy: 'plugin',
      side: 'right',
      type: 'add-widget',
      // Ids are namespaced by the host — the manifest says `load`.
      widgetId: 'acme.thing.load',
    },
  ])

  // The key resolves to the plugin's action, which nothing has registered yet:
  // that is a press that does nothing, not a crash.
  expect(() => pressLeaderThen('navigation', '%')).not.toThrow()

  const withdrawn = await captured(async () => harness.dispose())
  expect(withdrawn).toEqual([{ type: 'remove-plugin-widget', widgetId: 'acme.thing.load' }])
})

test('an unknown side is named, not swallowed', () => {
  const parsed = parseManifest(manifestWith({ bars: [{ side: 'middle', widget: 'load' }] }))
  expect(parsed.ok).toBe(false)
  if (parsed.ok) return
  expect(parsed.issues).toEqual([
    { field: 'contributes.bars[0].side', message: 'must be "left" or "right"' },
  ])
})

test('a binding missing its action is named by field', () => {
  const parsed = parseManifest(manifestWith({ keymaps: [{ key: 'q', mode: 'navigation' }] }))
  expect(parsed.ok).toBe(false)
  if (parsed.ok) return
  expect(parsed.issues).toEqual([
    { field: 'contributes.keymaps[0].action', message: 'must be a non-empty string' },
  ])
})

test('contributes is optional, and an empty block is valid', () => {
  expect(parseManifest(manifestWith(undefined)).ok).toBe(true)
  expect(parseManifest(manifestWith({})).ok).toBe(true)
})
