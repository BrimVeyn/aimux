import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRpcTransport } from '../../src/plugins/types'

import { discoverPlugins } from '../../src/plugins/discovery'
import { buildExecEnv, listExecCommands, runExecCommand } from '../../src/plugins/exec-adapter'
import { PluginRuntime } from '../../src/plugins/loader'
import { upsertPluginRegistryEntry } from '../../src/plugins/registry-file'

/**
 * The "written in any language" half. A manifest's `commands[]` need no
 * TypeScript and no `entries` at all: each is an argv the daemon spawns with
 * `AIMUX_*` in the environment, and the plugin talks back through the `aimux`
 * CLI it already has. No SDK, nothing to keep in sync per language.
 */

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalWatch = process.env.AIMUX_PLUGIN_WATCH
const originalXdg = process.env.XDG_RUNTIME_DIR

let tempHome = ''
let runtime: PluginRuntime | null = null

const TRANSPORT: PluginRpcTransport = { broadcast: () => {}, call: async () => null }

function stage(): string {
  const root = join(tempHome, 'exec-only')
  cpSync(join(FIXTURES, 'exec-only'), root, { recursive: true })
  upsertPluginRegistryEntry({
    enabled: true,
    id: 'aimux-test.execonly',
    path: root,
    source: 'link',
  })
  return root
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-exec-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'exec-test'
  process.env.AIMUX_PLUGIN_WATCH = '0'
  delete process.env.XDG_RUNTIME_DIR
})

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (originalWatch === undefined) delete process.env.AIMUX_PLUGIN_WATCH
  else process.env.AIMUX_PLUGIN_WATCH = originalWatch
  if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR
  else process.env.XDG_RUNTIME_DIR = originalXdg
  rmSync(tempHome, { force: true, recursive: true })
})

describe('exec adapter', () => {
  test('a manifest with only commands is a valid plugin', async () => {
    stage()
    const { issues, records } = await discoverPlugins()

    // No `entries` at all. That is the point: a shell script is a plugin.
    expect(issues).toEqual([])
    expect(records).toHaveLength(1)
    expect(records[0]?.manifest.entries).toBeUndefined()
    expect(records[0]?.manifest.commands).toHaveLength(3)
  })

  test('a commands-only plugin loads no half and stays out of the kernel', async () => {
    stage()
    const instance = new PluginRuntime({ host: 'daemon', transport: TRANSPORT, userPlugins: [] })
    runtime = instance
    await instance.start()

    // Nothing to import, so no fiber — but the record is known, which is what
    // the exec adapter reads.
    expect(instance.statuses()).toEqual([])
    expect(instance.knownRecords().map((record) => record.id)).toEqual(['aimux-test.execonly'])
  })

  test('listing reports every declared command', async () => {
    stage()
    const { records } = await discoverPlugins()
    expect(
      listExecCommands(records)
        .map((command) => command.id)
        .sort()
    ).toEqual(['echo', 'env', 'fail'])
    expect(listExecCommands(records)[0]?.pluginId).toBe('aimux-test.execonly')
  })

  test('a disabled plugin contributes no commands', async () => {
    const root = stage()
    upsertPluginRegistryEntry({
      enabled: false,
      id: 'aimux-test.execonly',
      path: root,
      source: 'link',
    })
    const { records } = await discoverPlugins()
    expect(listExecCommands(records)).toEqual([])
  })

  test('the injected environment names the socket, the binary and the directories', async () => {
    stage()
    const { records } = await discoverPlugins()
    const record = records[0]
    if (!record) return

    const env = buildExecEnv(record, { tabId: 't1' })
    // The two that matter: with them a command in any language can call back
    // with `aimux tab send`, `aimux worker run`, and the rest.
    expect(env.AIMUX_BIN_PATH).toBeTruthy()
    expect(env.AIMUX_SOCKET_PATH).toContain('daemon.sock')
    expect(env.AIMUX_PLUGIN_ID).toBe('aimux-test.execonly')
    expect(env.AIMUX_PLUGIN_ROOT).toBe(record.root)
    expect(env.AIMUX_PLUGIN_CONFIG_DIR).toContain('plugins-config')
    expect(env.AIMUX_PLUGIN_STATE_DIR).toContain('plugins-state')
    expect(env.AIMUX_ENV).toBe('1')
    expect(JSON.parse(env.AIMUX_CONTEXT_JSON ?? '{}')).toEqual({ tabId: 't1' })
  })

  test('running a command spawns it with that environment', async () => {
    stage()
    const { records } = await discoverPlugins()
    const record = records[0]
    if (!record) return

    const result = await runExecCommand(record, 'env', [], { why: 'test' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('AIMUX_PLUGIN_ID=aimux-test.execonly')
    expect(result.stdout).toContain('AIMUX_ENV=1')
    expect(result.stdout).toContain('AIMUX_CONTEXT_JSON={"why":"test"}')
  })

  test('arguments are appended to the declared argv', async () => {
    stage()
    const { records } = await discoverPlugins()
    const record = records[0]
    if (!record) return

    const result = await runExecCommand(record, 'echo', ['hello', 'world'])
    expect(result.stdout.trim()).toBe('hello world')
  })

  test('a non-zero exit is an outcome, not a throw', async () => {
    stage()
    const { records } = await discoverPlugins()
    const record = records[0]
    if (!record) return

    // An exit code is the command's answer; the caller decides what it means.
    const result = await runExecCommand(record, 'fail')
    expect(result.exitCode).toBe(3)
    expect(result.stderr.trim()).toBe('oops')
    expect(result.timedOut).toBe(false)
  })

  test('an undeclared command id throws rather than spawning something', async () => {
    stage()
    const { records } = await discoverPlugins()
    const record = records[0]
    if (!record) return

    expect(runExecCommand(record, 'not-declared')).rejects.toThrow(/declares no command/)
  })
})
