import { describe, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * `aimux __complete` runs on every TAB press. It must never drag the terminal
 * renderer into the process — that would put ~100ms of module init between a
 * keystroke and a completion list. This test walks the STATIC import graph of
 * the completion entrypoint and fails if a renderer module is reachable.
 *
 * Dynamic `await import(...)` is deliberately not followed: that's the escape
 * hatch the completion code uses for anything heavy (see `sources.ts`).
 */

const ENTRY = resolve(import.meta.dir, '../../src/cli/completion/entry.ts')

const BANNED = ['@opentui/core', '@opentui/react', 'react', 'react/jsx-runtime']

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\s)[^'"\n]*from\s*['"]([^'"]+)['"]/gm
const BARE_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function resolveModule(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('.')) return null
  // `.ts`/`.tsx` first: `src/config` is both a file and a directory.
  const base = resolve(dirname(fromFile), specifier)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
    if (isFile(candidate)) return candidate
  }
  return null
}

async function crawl(entry: string): Promise<{ files: Set<string>; packages: Set<string> }> {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || files.has(file)) continue
    files.add(file)
    const source = await Bun.file(file).text()
    const specifiers = [
      ...[...source.matchAll(STATIC_IMPORT)].map((m) => m[1]),
      ...[...source.matchAll(BARE_IMPORT)].map((m) => m[1]),
    ]
    for (const specifier of specifiers) {
      if (specifier === undefined) continue
      if (!specifier.startsWith('.')) {
        packages.add(specifier)
        continue
      }
      const resolved = resolveModule(specifier, file)
      if (resolved !== null && resolved.endsWith('.json')) continue
      if (resolved !== null) queue.push(resolved)
    }
  }

  return { files, packages }
}

describe('completion module graph', () => {
  test('the TAB path never statically imports the terminal renderer', async () => {
    const { packages } = await crawl(ENTRY)
    for (const banned of BANNED) {
      expect([...packages]).not.toContain(banned)
    }
  })

  test('the TAB path never statically imports the app root', async () => {
    const { files } = await crawl(ENTRY)
    const appModules = [...files].filter(
      (file) => file.endsWith('/src/app.tsx') || file.includes('/src/app-runtime/')
    )
    expect(appModules).toEqual([])
  })

  test('the entrypoint keeps its heavy branches behind dynamic imports', async () => {
    const source = await Bun.file(resolve(import.meta.dir, '../../src/index.tsx')).text()
    const staticSpecifiers = [...source.matchAll(STATIC_IMPORT)].map((m) => m[1])
    expect(staticSpecifiers).toEqual([])
  })
})
