#!/usr/bin/env bun
/* eslint-disable no-console */
// Copies every TUI theme JSON from a local opencode checkout into
// packages/aimux-config/src/tui/themes/. Idempotent — re-run to refresh.
//
// Usage: bun scripts/import-opencode-tui-themes.ts [--src ../opencode]

import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = Bun.argv.slice(2)
const srcArgIdx = args.indexOf('--src')
const SRC = resolve(srcArgIdx >= 0 ? (args[srcArgIdx + 1] ?? '') : '../opencode')
const SRC_DIR = join(SRC, 'packages', 'opencode', 'src', 'cli', 'cmd', 'tui', 'context', 'theme')
const OUT_DIR = join(import.meta.dir, '..', 'packages', 'aimux-config', 'src', 'tui', 'themes')

const HOUSE = new Set(['aimux.json'])

function main() {
  console.log(`Source: ${SRC_DIR}`)
  console.log(`Target: ${OUT_DIR}`)

  mkdirSync(OUT_DIR, { recursive: true })

  // Wipe non-house JSONs so removed upstream themes vanish locally too.
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith('.json') && !HOUSE.has(f)) rmSync(join(OUT_DIR, f))
  }

  let count = 0
  for (const f of readdirSync(SRC_DIR)) {
    if (!f.endsWith('.json')) continue
    if (HOUSE.has(f)) continue
    copyFileSync(join(SRC_DIR, f), join(OUT_DIR, f))
    count += 1
  }
  console.log(`Imported ${count} theme(s).`)
}

main()
