import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildPluginEntry } from '../../src/plugins/module-loader'
import { getPluginHotDir } from '../../src/plugins/paths'

/**
 * Build artifacts are pruned so a `.hot` directory does not grow forever, and
 * the prune used to sort by *name*. That is only the same as sorting by age
 * while every artifact shares a prefix — and a plugin with two halves does not:
 * `daemon-<n>` sorts before `ui-<n>` whatever the numbers say, so the freshly
 * built daemon artifact was the one deleted. The half then failed to load with
 * an ENOENT naming a file the plugin author never wrote.
 */

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')
const PLUGIN_ID = 'aimux-test.hello'

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE

let tempHome = ''

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-hot-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'hot-test'
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

async function build(half: 'ui' | 'daemon', revision: number): Promise<string> {
  return buildPluginEntry({
    entryPath: join(FIXTURES, 'hello', `${half}.ts`),
    half,
    pluginId: PLUGIN_ID,
    revision,
  })
}

describe('hot build artifacts', () => {
  test('the artifact just written is never the one pruned', async () => {
    // Enough rounds to go past the keep budget several times over, alternating
    // halves so the two prefixes interleave.
    for (let revision = 1; revision <= 6; revision++) {
      const ui = await build('ui', revision)
      expect(existsSync(ui)).toBe(true)
      const daemon = await build('daemon', revision)
      expect(existsSync(daemon)).toBe(true)
      // And the one built a moment ago is still there: pruning must not eat
      // the other half between two loads of the same plugin.
      expect(existsSync(ui)).toBe(true)
    }
  })

  test('and the directory still does not grow without bound', async () => {
    for (let revision = 1; revision <= 8; revision++) await build('ui', revision)

    const kept = readdirSync(getPluginHotDir(PLUGIN_ID)).filter((name) => name.endsWith('.mjs'))
    expect(kept.length).toBeLessThanOrEqual(3)
  })
})
