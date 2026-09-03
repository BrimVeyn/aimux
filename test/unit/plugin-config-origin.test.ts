import { PLUGIN_API_VERSION, type PluginManifest } from '@brimveyn/aimux-plugin'
import { describe, expect, test } from 'bun:test'

import {
  coerceConfigValue,
  describePluginConfig,
  SECRET_PLACEHOLDER,
  undeclaredKeys,
} from '../../src/plugins/config-origin'

/**
 * One implementation of "which layer won", used by `aimux plugin config` and
 * by the settings rows. A second copy would drift the first time a layer
 * moved, and the two surfaces would then disagree about the same value in
 * front of the same user.
 */

const MANIFEST: PluginManifest = {
  apiVersion: PLUGIN_API_VERSION,
  config: {
    botToken: { label: 'Bot token', required: true, secret: true, type: 'string' },
    pollSeconds: { default: 3, label: 'Poll every', type: 'number' },
    verbose: { label: 'Verbose', type: 'boolean' },
  },
  id: 'acme.thing',
  version: '1.0.0',
}

function fieldsOf(
  resolved: Record<string, unknown>,
  layers: Parameters<typeof describePluginConfig>[2]
): Record<string, ReturnType<typeof describePluginConfig>[number]> {
  return Object.fromEntries(
    describePluginConfig(MANIFEST, resolved, layers).map((field) => [field.key, field])
  )
}

describe('where a config value came from', () => {
  test('nothing set: the manifest default, or unset', () => {
    const fields = fieldsOf({ pollSeconds: 3 }, {})

    expect(fields.pollSeconds?.origin).toBe('manifest-default')
    expect(fields.pollSeconds?.isSet).toBe(false)
    // No default and nobody set it — distinct from "defaulted", because only
    // one of the two is worth offering to reset.
    expect(fields.verbose?.origin).toBe('unset')
  })

  test('the ladder, layer by layer', () => {
    expect(
      fieldsOf({ pollSeconds: 9 }, { builtinConfig: { pollSeconds: 9 } }).pollSeconds?.origin
    ).toBe('builtin')
    expect(
      fieldsOf({ pollSeconds: 9 }, { rowConfig: { pollSeconds: 9 } }).pollSeconds?.origin
    ).toBe('registry')
    expect(
      fieldsOf({ pollSeconds: 9 }, { override: { config: { pollSeconds: 9 } } }).pollSeconds?.origin
    ).toBe('registry')
    expect(
      fieldsOf({ pollSeconds: 9 }, { userConfig: { pollSeconds: 9 } }).pollSeconds?.origin
    ).toBe('config')
  })

  test('the hand-written file wins, and says so', () => {
    const fields = fieldsOf(
      { pollSeconds: 30 },
      { override: { config: { pollSeconds: 5 } }, userConfig: { pollSeconds: 30 } }
    )

    // The override is still written and still recorded; it is outranked, and
    // saying which line to edit beats a value that silently does nothing.
    expect(fields.pollSeconds?.origin).toBe('config')
    expect(fields.pollSeconds?.shadowedBy).toBe('aimux.config.ts')
  })

  test('a secret is never echoed, at any layer', () => {
    const fields = fieldsOf(
      { botToken: 'hunter2' },
      { override: { config: { botToken: 'hunter2' } } }
    )

    expect(fields.botToken?.value).toBe(SECRET_PLACEHOLDER)
    expect(fields.botToken?.secret).toBe(true)
    // But it is still reported as set, which is the one thing about a secret
    // the user needs to see.
    expect(fields.botToken?.isSet).toBe(true)
  })

  test('an unset secret reads as undefined, not as the placeholder', () => {
    expect(fieldsOf({}, {}).botToken?.value).toBeUndefined()
  })

  test('keys the schema does not declare are reported, not hidden', () => {
    // `resolvePluginConfig` passes them through by design; hiding them would
    // make this disagree with what the plugin actually receives.
    expect(undeclaredKeys(MANIFEST, { pollSeconds: 3, tools: ['codex'] })).toEqual({
      tools: ['codex'],
    })
  })
})

describe('coercing a value from the command line', () => {
  test('by the declared type', () => {
    expect(coerceConfigValue({ type: 'string' }, '30')).toEqual({ ok: true, value: '30' })
    expect(coerceConfigValue({ type: 'number' }, '30')).toEqual({ ok: true, value: 30 })
    expect(coerceConfigValue({ type: 'boolean' }, 'true')).toEqual({ ok: true, value: true })
  })

  test('and refuses rather than guesses', () => {
    // A loose coercion would write something `resolvePluginConfig` then drops
    // with an issue — the worst outcome available, because nothing fails.
    expect(coerceConfigValue({ type: 'number' }, 'soon').ok).toBe(false)
    expect(coerceConfigValue({ type: 'boolean' }, 'yes').ok).toBe(false)
    expect(coerceConfigValue({ type: 'number' }, '').ok).toBe(false)
  })
})
