import { getDefaultKeymapConfig } from '@brimveyn/aimux-config'

import type { CliCommand } from '../../registry'

import { parseKeyNotation } from '../../../input/keymap/key-chord'
import { describePluginKeymaps } from '../../../plugins/config-origin'
import { getPluginOverride, setPluginOverride } from '../../../plugins/registry-file'
import { CliUsageError, SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyRunningDaemon, requireKnownPlugin } from './shared'

function requireBinding(
  record: Awaited<ReturnType<typeof requireKnownPlugin>>['record'],
  id: string
) {
  const binding = record.keymaps.find((entry) => entry.id === id)
  if (binding) return binding
  const declared = record.keymaps.map((entry) => entry.id)
  throw new CliUsageError(
    declared.length === 0
      ? `plugin "${record.id}" declares no keymaps`
      : `unknown keymap id "${id}" — ${record.id} declares: ${declared.join(', ')}`
  )
}

export const pluginKeymaps: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true }],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    const { record, userEntry } = await requireKnownPlugin(id)
    writeJson({
      id,
      keymaps: describePluginKeymaps(record.manifest, {
        ...(getPluginOverride(id) === undefined ? {} : { override: getPluginOverride(id) }),
        ...(userEntry?.keymaps === undefined ? {} : { userConfig: userEntry.keymaps }),
      }),
    })
    return EXIT_OK
  },
  summary: "Show one plugin's resolved keybindings and their origins",
  verb: 'keymaps',
}

async function writeBinding(
  id: string,
  bindingId: string,
  value: string | null | undefined
): Promise<number> {
  const { record, userEntry } = await requireKnownPlugin(id)
  const binding = requireBinding(record, bindingId)
  if (typeof value === 'string') {
    try {
      const leader = parseKeyNotation(getDefaultKeymapConfig().leader)[0]
      if (parseKeyNotation(value, leader).length === 0) throw new Error('empty notation')
    } catch (error) {
      throw new CliUsageError(`${id}.${bindingId}: invalid key notation (${String(error)})`)
    }
  }
  if (!setPluginOverride(id, { keymaps: { [bindingId]: value } })) {
    writeError('could not write the plugin registry')
    writeJson({ error: 'registry write failed', id, key: bindingId, kind: 'write-failed' })
    return EXIT_RUNTIME
  }
  const shadowed = userEntry?.keymaps?.[bindingId] !== undefined
  if (shadowed) writeError(`${id}.${bindingId} is declared in aimux.config.ts and keeps winning`)
  const refreshed = await notifyRunningDaemon('refresh')
  writeJson({
    daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
    id,
    key: bindingId,
    shadowedBy: shadowed ? 'aimux.config.ts' : null,
    value: value === undefined ? binding.default : value,
    written: true,
  })
  return EXIT_OK
}

export const pluginBind: CliCommand = {
  args: [
    { complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true },
    {
      complete: { kind: 'dynamic', source: 'plugin-keymap-id' },
      name: 'bindingId',
      required: true,
    },
    { complete: { kind: 'none' }, name: 'notation' },
  ],
  flags: [
    ...SHARED_FLAGS,
    { description: 'Remove the registry override', kind: 'boolean', name: 'reset' },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const [id = '', bindingId = '', notation] = ctx.args.positionals
    if (ctx.args.flags.reset === true) return writeBinding(id, bindingId, undefined)
    if (notation === undefined)
      throw new CliUsageError('missing <notation> — pass one, or use --reset')
    return writeBinding(id, bindingId, notation)
  },
  summary: 'Bind one plugin keymap contribution',
  verb: 'bind',
}

export const pluginUnbind: CliCommand = {
  args: [
    { complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true },
    {
      complete: { kind: 'dynamic', source: 'plugin-keymap-id' },
      name: 'bindingId',
      required: true,
    },
  ],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const [id = '', bindingId = ''] = ctx.args.positionals
    return writeBinding(id, bindingId, null)
  },
  summary: 'Unbind one plugin keymap contribution',
  verb: 'unbind',
}
