import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planCompletion } from '../../src/cli/completion/plan'
import {
  clearPluginCliCommands,
  getPluginCliCommand,
  listPluginCliCommands,
  pluginCliSidecarPath,
  readPluginCliSidecar,
  registerPluginCliCommand,
} from '../../src/plugins/cli-commands'

/**
 * A plugin's command runs in the daemon; the CLI only learns its shape. That
 * split is what keeps `aimux tab list` from paying every plugin's startup cost
 * — and keeps a broken plugin from breaking commands that have nothing to do
 * with it. The sidecar is how the shape crosses over.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalXdg = process.env.XDG_RUNTIME_DIR
let tempHome = ''

const COMMAND = {
  args: [{ name: 'target', required: true }],
  flags: [{ description: 'Do it twice', kind: 'boolean' as const, name: 'twice' }],
  group: 'acme',
  pluginId: 'acme.thing',
  run: async () => ({ ok: true }),
  summary: 'Ping the robot',
  verb: 'ping',
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-plugin-cli-'))
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'plugin-cli-test'
  delete process.env.XDG_RUNTIME_DIR
})

afterEach(() => {
  clearPluginCliCommands()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR
  else process.env.XDG_RUNTIME_DIR = originalXdg
  rmSync(tempHome, { force: true, recursive: true })
})

describe('plugin CLI commands', () => {
  test('registering writes the shape to the sidecar', () => {
    registerPluginCliCommand(COMMAND)

    const specs = readPluginCliSidecar()
    expect(specs).toHaveLength(1)
    expect(specs[0]?.group).toBe('acme')
    expect(specs[0]?.verb).toBe('ping')
    expect(specs[0]?.pluginId).toBe('acme.thing')
    // The flags and args cross over so the CLI can parse and report a usage
    // error at the same speed as for a built-in verb, without a socket.
    expect(specs[0]?.flags?.[0]?.name).toBe('twice')
    expect(specs[0]?.args?.[0]?.name).toBe('target')
  })

  test('the handler stays in the daemon and is not serialised', () => {
    registerPluginCliCommand(COMMAND)
    expect(getPluginCliCommand('acme', 'ping')?.run).toBeDefined()
    expect(JSON.stringify(readPluginCliSidecar())).not.toContain('run')
  })

  test('disposing rewrites the sidecar without the verb', () => {
    const dispose = registerPluginCliCommand(COMMAND)
    expect(readPluginCliSidecar()).toHaveLength(1)

    dispose()
    // Completion must stop offering a verb nothing can answer.
    expect(readPluginCliSidecar()).toEqual([])
    expect(listPluginCliCommands()).toEqual([])
  })

  test('a missing sidecar is an empty list, not an error', () => {
    expect(readPluginCliSidecar()).toEqual([])
  })

  test('a corrupt sidecar is an empty list, not an error', async () => {
    // Completion offering nothing is a non-event; completion throwing prints
    // an error into the user's prompt.
    await Bun.write(pluginCliSidecarPath(), '{ not json')
    expect(readPluginCliSidecar()).toEqual([])

    await Bun.write(pluginCliSidecarPath(), JSON.stringify({ commands: 'nope', version: 1 }))
    expect(readPluginCliSidecar()).toEqual([])
  })

  test('a stale disposer does not remove the replacement', () => {
    const stale = registerPluginCliCommand(COMMAND)
    registerPluginCliCommand({ ...COMMAND, summary: 'Ping harder' })
    stale()
    expect(getPluginCliCommand('acme', 'ping')?.summary).toBe('Ping harder')
  })
})

describe('completion with plugin commands', () => {
  const specs = [
    { group: 'acme', pluginId: 'acme.thing', summary: 'Ping the robot', verb: 'ping' },
    { group: 'acme', pluginId: 'acme.thing', summary: 'Stop the robot', verb: 'stop' },
  ]

  test('the plugin group is offered at the top level, beside the built-in ones', () => {
    const plan = planCompletion(['aimux', 'ac'], 1, specs)
    expect(plan.kind).toBe('candidates')
    if (plan.kind !== 'candidates') return
    // `action` is aimux's own group; a plugin's sits next to it rather than
    // in a section of its own, which is the whole point of the merge.
    expect(plan.candidates.map((candidate) => candidate.value)).toEqual(['action', 'acme'])
  })

  test('its verbs are offered inside the group', () => {
    const plan = planCompletion(['aimux', 'acme', ''], 2, specs)
    expect(plan.kind).toBe('candidates')
    if (plan.kind !== 'candidates') return
    expect(plan.candidates.map((candidate) => candidate.value)).toEqual(['ping', 'stop'])
  })

  test('the built-in groups are untouched', () => {
    const plan = planCompletion(['aimux', 'ta'], 1, specs)
    if (plan.kind !== 'candidates') return
    expect(plan.candidates.map((candidate) => candidate.value)).toEqual(['tab'])
  })

  test('with no plugin commands nothing changes', () => {
    const plan = planCompletion(['aimux', 'acme', ''], 2)
    // The planner stays pure: it is handed the list, it never reads it.
    expect(plan.kind).toBe('none')
  })
})
