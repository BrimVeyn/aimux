import type { CliCommand } from '../../registry'

import {
  PLUGIN_CONTROL_SERVICE_LIST,
  PLUGIN_CONTROL_SERVICE_RESTART,
} from '../../../plugins/rpc-envelope'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyDaemon } from './shared'

/**
 * The processes `services[]` asked the daemon to keep alive, with their
 * state, pid and restart count — the answer to "is my relay actually
 * running", which `plugin list` cannot give because a service is not a fiber.
 */
export const pluginServices: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_SERVICE_LIST)
    if (!outcome.ok) {
      writeError(outcome.detail ?? 'could not reach the daemon')
      writeJson({ error: outcome.detail ?? 'unreachable', kind: 'runtime-error' })
      return EXIT_RUNTIME
    }
    writeJson(outcome.result ?? { services: [] })
    return EXIT_OK
  },
  summary: 'List the services the daemon supervises for plugins',
  verb: 'services',
}

export const pluginRestartService: CliCommand = {
  args: [
    { complete: { kind: 'dynamic', source: 'plugin' }, name: 'plugin-id', required: true },
    { complete: { kind: 'none' }, name: 'service-id', required: true },
  ],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const [pluginId = '', serviceId = ''] = ctx.args.positionals
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_SERVICE_RESTART, {
      pluginId,
      serviceId,
    })
    if (!outcome.ok) {
      writeError(outcome.detail ?? 'could not reach the daemon')
      writeJson({ error: outcome.detail ?? 'unreachable', kind: 'runtime-error' })
      return EXIT_RUNTIME
    }
    writeJson({ pluginId, serviceId, ...(outcome.result as object) })
    return EXIT_OK
  },
  summary: 'Stop one supervised service and start it again',
  verb: 'restart-service',
}
