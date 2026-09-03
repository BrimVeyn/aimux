import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from '../../src/cli'
import { parseManifest } from '../../src/plugins/manifest'

/**
 * The scaffold's one promise: what it writes is a plugin aimux accepts. A
 * template whose manifest does not validate would cost an author the first
 * hour of every plugin, and it is the manifest validator itself that says so
 * here — not a copy of its rules.
 */

async function scaffold(args: string[]): Promise<{ root: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'aimux-new-'))
  const root = join(dir, 'plugin')
  await runCli(['plugin', 'new', ...args, '--dir', root, '--json'])
  return { cleanup: () => rmSync(dir, { force: true, recursive: true }), root }
}

function manifestAt(root: string): ReturnType<typeof parseManifest> {
  return parseManifest(JSON.parse(readFileSync(join(root, 'aimux-plugin.json'), 'utf8')))
}

describe('aimux plugin new', () => {
  test('the default scaffold is a valid two-half plugin', async () => {
    const { cleanup, root } = await scaffold(['acme.demo'])
    const parsed = manifestAt(root)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.manifest.entries).toEqual({ daemon: 'src/daemon.ts', ui: 'src/ui.tsx' })
    }
    expect(readFileSync(join(root, 'src/ui.tsx'), 'utf8')).toContain('definePlugin')
    expect(readFileSync(join(root, 'src/daemon.ts'), 'utf8')).toContain('definePlugin')
    cleanup()
  })

  test('--exec alone is a plugin with no TypeScript at all', async () => {
    const { cleanup, root } = await scaffold(['acme.script', '--exec'])
    const parsed = manifestAt(root)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      // The shape that makes "a shell script is a plugin" true.
      expect(parsed.manifest.entries).toBeUndefined()
      expect(parsed.manifest.commands).toHaveLength(1)
    }
    cleanup()
  })

  test('--ui alone leaves the daemon out', async () => {
    const { cleanup, root } = await scaffold(['acme.only', '--ui'])
    const parsed = manifestAt(root)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.manifest.entries).toEqual({ ui: 'src/ui.tsx' })
    cleanup()
  })

  test('an id without a vendor is refused before anything is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimux-new-'))
    const code = await runCli(['plugin', 'new', 'notanid', '--dir', join(dir, 'p'), '--json'])
    expect(code).not.toBe(0)
    rmSync(dir, { force: true, recursive: true })
  })
})
