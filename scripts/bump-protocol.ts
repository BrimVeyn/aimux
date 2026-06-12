#!/usr/bin/env bun
/* eslint-disable no-console -- protocol bump CLI: console is the UI */
// Bump a wire protocol version. A breaking wire change raises both the MIN and
// the (max) VERSION constant in lockstep — see the changelog comments above
// each pair — so only exact-version peers negotiate. This script does exactly
// that: reads the current VERSION, increments it, and writes the same number
// back to both constants.
//
// Usage: bun run scripts/bump-protocol.ts <ipc | terminal-manager>
//   (exposed as `bun bump:ipc` and `bun bump:terminal_manager`)

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

interface Protocol {
  label: string
  file: string
  minConst: string
  versionConst: string
}

const PROTOCOLS: Record<string, Protocol> = {
  'ipc': {
    file: join(ROOT, 'src/ipc/protocol.ts'),
    label: 'IPC (app ↔ daemon)',
    minConst: 'IPC_PROTOCOL_MIN_VERSION',
    versionConst: 'IPC_PROTOCOL_VERSION',
  },
  'terminal-manager': {
    file: join(ROOT, 'src/ipc/manager-protocol.ts'),
    label: 'Manager (daemon ↔ terminal-manager)',
    minConst: 'MANAGER_PROTOCOL_MIN_VERSION',
    versionConst: 'MANAGER_PROTOCOL_VERSION',
  },
}

function fail(msg: string): never {
  console.error(`[31merror[0m: ${msg}`)
  process.exit(1)
}

function readConst(raw: string, name: string): number {
  const match = new RegExp(`export const ${name} = (\\d+)`).exec(raw)
  if (!match) fail(`could not find \`${name}\``)
  return Number(match[1])
}

function rewriteConst(raw: string, name: string, next: number): string {
  const updated = raw.replace(
    new RegExp(`(export const ${name} = )\\d+`),
    (_m, prefix: string) => `${prefix}${next}`
  )
  if (updated === raw) fail(`failed to rewrite \`${name}\``)
  return updated
}

function main() {
  const arg = process.argv[2]
  const proto = arg === undefined ? undefined : PROTOCOLS[arg]
  if (!proto) {
    fail(`expected one of: ${Object.keys(PROTOCOLS).join(', ')}`)
  }

  const raw = readFileSync(proto.file, 'utf8')
  const prev = readConst(raw, proto.versionConst)
  const min = readConst(raw, proto.minConst)
  const next = prev + 1

  const updated = rewriteConst(rewriteConst(raw, proto.minConst, next), proto.versionConst, next)
  writeFileSync(proto.file, updated)

  console.log(
    `[36m${proto.label}[0m ${min}/${prev} → [32m${next}/${next}[0m (min/version, lockstep)`
  )
}

main()
