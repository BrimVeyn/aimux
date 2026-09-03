import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRecord } from '../../src/plugins/types'

import { readPluginLog } from '../../src/plugins/log'
import { getPluginPaths } from '../../src/plugins/paths'
import { ServiceSupervisor } from '../../src/plugins/service-supervisor'

/**
 * A service is a process the daemon keeps alive: up while the plugin is
 * enabled, restarted when it crashes, gone when the plugin is.
 */
const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
let tempHome = ''
let supervisor: ServiceSupervisor | null = null

function record(id: string, services: PluginRecord['manifest']['services']): PluginRecord {
  const root = join(tempHome, id)
  mkdirSync(root, { recursive: true })
  return {
    config: {},
    enabled: true,
    enabledFrom: 'default',
    id,
    manifest: { apiVersion: 1, id, services, version: '1.0.0' },
    paths: getPluginPaths(id, root),
    root,
    source: 'link',
  }
}

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check: () => boolean, timeoutMs = 4_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await sleep(25)
  }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-services-'))
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'services-test'
  supervisor = new ServiceSupervisor()
})

afterEach(() => {
  supervisor?.dispose()
  supervisor = null
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

describe('service supervisor', () => {
  test('starts a declared service with the plugin environment, and stops it with the plugin', async () => {
    const sup = supervisor as ServiceSupervisor
    const plugin = record('acme.relay', [
      { command: ['sh', '-c', 'echo "id=$AIMUX_PLUGIN_ID"; sleep 30'], id: 'relay' },
    ])
    sup.reconcile([plugin])
    await until(() => sup.statuses()[0]?.state === 'running')
    const running = sup.statuses()[0]
    expect(running?.pid).not.toBeNull()
    expect(running?.pluginId).toBe('acme.relay')

    await until(() =>
      readPluginLog('acme.relay').some((entry) => entry.message === 'id=acme.relay')
    )

    sup.reconcile([])
    expect(sup.statuses()).toEqual([])
  })

  test('a crash comes back, a clean exit stays down', async () => {
    const sup = supervisor as ServiceSupervisor
    sup.reconcile([
      record('acme.flaky', [
        { command: ['sh', '-c', 'exit 3'], id: 'crash' },
        { command: ['sh', '-c', 'exit 0'], id: 'done' },
      ]),
    ])
    await until(() => {
      const byId = new Map(sup.statuses().map((status) => [status.id, status]))
      return (byId.get('crash')?.restarts ?? 0) >= 1 && byId.get('done')?.state === 'stopped'
    })
    const byId = new Map(sup.statuses().map((status) => [status.id, status]))
    expect(byId.get('crash')?.lastExitCode).toBe(3)
    expect(byId.get('done')?.restarts).toBe(0)
  })

  test('a changed argv restarts the service under the new one', async () => {
    const sup = supervisor as ServiceSupervisor
    const first = record('acme.watch', [{ command: ['sleep', '30'], id: 'w' }])
    sup.reconcile([first])
    await until(() => sup.statuses()[0]?.state === 'running')
    const pid = sup.statuses()[0]?.pid

    const next = record('acme.watch', [{ command: ['sleep', '31'], id: 'w' }])
    sup.reconcile([next])
    await until(() => sup.statuses()[0]?.state === 'running' && sup.statuses()[0]?.pid !== pid)
    expect(sup.statuses()[0]?.command).toEqual(['sleep', '31'])
  })
})
