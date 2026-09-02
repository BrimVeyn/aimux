import type { PluginConfigField } from '@brimveyn/aimux-plugin'

import type { CliCommand } from '../../registry'

import {
  coerceConfigValue,
  describePluginConfig,
  SECRET_PLACEHOLDER,
  undeclaredKeys,
} from '../../../plugins/config-origin'
import { getPluginOverride, setPluginOverride } from '../../../plugins/registry-file'
import { CliUsageError, SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyRunningDaemon, requireKnownPlugin } from './shared'

/**
 * Reading and writing one plugin's configuration, from a script.
 *
 * `config` reports where each value came from rather than only what it is:
 * a value the user is about to change is worth knowing the owner of, and
 * `aimux.config.ts` outranks anything written here.
 */
export const pluginConfig: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true }],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    const { record, userEntry } = await requireKnownPlugin(id)

    writeJson({
      enabled: record.enabled,
      enabledFrom: record.enabledFrom,
      // Keys the resolved config carries that the schema does not declare.
      // `resolvePluginConfig` passes them through by design, and hiding them
      // would make this disagree with what the plugin actually receives.
      extraKeys: undeclaredKeys(record.manifest, record.config),
      fields: describePluginConfig(record.manifest, record.config, {
        ...(getPluginOverride(id) === undefined ? {} : { override: getPluginOverride(id) }),
        ...(userEntry?.config === undefined ? {} : { userConfig: userEntry.config }),
      }),
      id,
      name: record.manifest.name ?? id,
      source: record.source,
      version: record.manifest.version,
    })
    return EXIT_OK
  },
  summary: "Show one plugin's configuration, and where each value came from",
  verb: 'config',
}

/** The declared field, or a usage error listing what the plugin does declare. */
function requireField(
  id: string,
  schema: Record<string, PluginConfigField> | undefined,
  key: string
): PluginConfigField {
  const fields = schema ?? {}
  const field = fields[key]
  if (field) return field
  const declared = Object.keys(fields)
  if (declared.length === 0) {
    throw new CliUsageError(`plugin "${id}" declares no config schema`)
  }
  // `resolvePluginConfig` would accept an undeclared key silently. For an
  // agent, a typo that lands somewhere no plugin reads is the worst outcome
  // available, because nothing fails.
  throw new CliUsageError(`unknown config key "${key}" — ${id} declares: ${declared.join(', ')}`)
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk)
  return new TextDecoder().decode(Buffer.concat(chunks)).replace(/\n$/, '')
}

export const pluginSet: CliCommand = {
  args: [
    { complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true },
    { complete: { kind: 'dynamic', source: 'plugin-config-key' }, name: 'key', required: true },
    { complete: { kind: 'none' }, name: 'value' },
  ],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'Read the value from stdin instead of the argument',
      kind: 'boolean',
      name: 'value-stdin',
    },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const [id = '', key = '', positional] = ctx.args.positionals
    const { record, userEntry } = await requireKnownPlugin(id)
    const field = requireField(id, record.manifest.config, key)

    // A token on the command line lands in the shell history and in `ps`.
    const raw =
      ctx.args.flags['value-stdin'] === true ? await readStdin() : (positional ?? undefined)
    if (raw === undefined) {
      throw new CliUsageError('missing <value> — pass one, or use --value-stdin')
    }

    const coerced = coerceConfigValue(field, raw)
    if (!coerced.ok) {
      throw new CliUsageError(`${id}.${key}: ${coerced.message}`)
    }

    if (!setPluginOverride(id, { config: { [key]: coerced.value } })) {
      writeError('could not write the plugin registry')
      writeJson({ error: 'registry write failed', id, key, kind: 'write-failed' })
      return EXIT_RUNTIME
    }

    const shadowed = userEntry?.config?.[key] !== undefined
    if (shadowed) {
      writeError(`${id}.${key} is declared in aimux.config.ts and keeps winning`)
    }

    const refreshed = await notifyRunningDaemon('refresh')
    writeJson({
      daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
      id,
      key,
      shadowedBy: shadowed ? 'aimux.config.ts' : null,
      value: field.secret === true ? SECRET_PLACEHOLDER : coerced.value,
      written: true,
    })
    return EXIT_OK
  },
  summary: 'Set one of a plugin config values',
  verb: 'set',
}

export const pluginUnset: CliCommand = {
  args: [
    { complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true },
    { complete: { kind: 'dynamic', source: 'plugin-config-key' }, name: 'key', required: true },
  ],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const [id = '', key = ''] = ctx.args.positionals
    const { record, userEntry } = await requireKnownPlugin(id)
    requireField(id, record.manifest.config, key)

    if (!setPluginOverride(id, { config: { [key]: undefined } })) {
      writeError('could not write the plugin registry')
      writeJson({ error: 'registry write failed', id, key, kind: 'write-failed' })
      return EXIT_RUNTIME
    }

    // Re-read: what the key falls back to is the useful half of the answer,
    // and only a fresh discovery knows it.
    const after = await requireKnownPlugin(id)
    const field = describePluginConfig(after.record.manifest, after.record.config, {
      ...(getPluginOverride(id) === undefined ? {} : { override: getPluginOverride(id) }),
      ...(userEntry?.config === undefined ? {} : { userConfig: userEntry.config }),
    }).find((entry) => entry.key === key)

    const refreshed = await notifyRunningDaemon('refresh')
    writeJson({
      daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
      id,
      key,
      origin: field?.origin ?? 'unset',
      removed: true,
      value: field?.value ?? null,
    })
    return EXIT_OK
  },
  summary: 'Remove a config value, falling back to what is underneath',
  verb: 'unset',
}
