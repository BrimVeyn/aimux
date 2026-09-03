#!/usr/bin/env bun
/* eslint-disable no-console -- discipline checker: console IS the UI */
//
// Protocol-discipline lint. Two rules from the hot-migration plan:
//
//   1. A MIN_VERSION bump in either wire protocol must be deliberate — the
//      bump kills client sessions (IPC) or every PTY (manager). The check
//      compares the working-tree MIN against the value on the `main` branch;
//      a raised MIN must be accompanied by a `BREAKING:` marker in any
//      commit in the range branch...main (or in the env var
//      `AIMUX_PROTOCOL_BREAKING_REASON`, useful for CI on `main` itself).
//
//   2. `src/terminal-manager/**` may not import `src/plugins/**`. The TM is
//      the process holding every PTY; loading plugin code there would put
//      session survival at the mercy of third-party code.
//
//   3. `stopTerminalManager(` may only be called from the dedicated
//      restart-terminal-manager command path. Anywhere else, the call must
//      be opted in with an `AIMUX_ALLOW_KILL_PTYS:` marker on the same or
//      preceding line — the marker is the engineer saying out loud "I know
//      this kills every PTY and I want that."
//
// Run via `bun run lint:protocol`. Designed to be CI-fast: pure regex over a
// handful of files, no AST.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

interface ProtocolSpec {
  label: string
  file: string
  minConst: string
}

const PROTOCOLS: ProtocolSpec[] = [
  {
    file: 'src/ipc/protocol.ts',
    label: 'IPC (app ↔ daemon)',
    minConst: 'IPC_PROTOCOL_MIN_VERSION',
  },
  {
    file: 'src/ipc/manager-protocol.ts',
    label: 'Manager (daemon ↔ terminal-manager)',
    minConst: 'MANAGER_PROTOCOL_MIN_VERSION',
  },
]

// The dedicated restart-tm command path is the one place where killing the
// TM is the *point*, not a side effect. Anywhere else — including the legacy
// bootstrap breaking-update path — must opt in with the marker comment so
// the engineer is saying "I know this kills every PTY."
const STOP_TM_ALLOWED_FILES = new Set(['src/restart-terminal-manager.ts'])
const STOP_TM_OPT_IN_MARKER = 'AIMUX_ALLOW_KILL_PTYS'
// Allow up to this many comment/blank lines between the marker and the
// guarded call. Tight enough that the marker stays load-bearing; loose
// enough to fit a short explanatory paragraph.
const STOP_TM_MARKER_LOOKBACK = 6

const BREAKING_MARKER = /\bBREAKING:/

// The terminal manager holds every PTY. A plugin crashing or hanging there
// would take live sessions with it, so the plugin kernel is barred from that
// process by construction rather than by convention.
const TM_PREFIX = 'src/terminal-manager/'
const PLUGIN_IMPORT = /from\s+['"][^'"]*\bplugins\//

interface Finding {
  rule: string
  message: string
  hint: string
}
const findings: Finding[] = []

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
}

function readMinConst(content: string, name: string): number | null {
  const match = new RegExp(`export const ${name} = (\\d+)`).exec(content)
  return match ? Number(match[1]) : null
}

function resolveBaseRef(): string | null {
  for (const ref of ['origin/main', 'main']) {
    const resolved = git(`rev-parse --verify --quiet ${ref}`)?.trim()
    if (resolved !== undefined && resolved !== '') return resolved
  }
  return null
}

function checkMinBumps(): void {
  // Pick the comparison base. Local dev usually has `origin/main`; CI checks
  // out a detached HEAD but still has it under the merge-base ref. Fall back
  // to `main` (the local branch tip) if neither resolves. If the comparison
  // can't be made at all, skip the check rather than fail noisily — running
  // outside a git checkout (e.g. a vendored copy) shouldn't break the lint.
  const base = resolveBaseRef()
  if (base === null) {
    console.warn('[discipline] skipping MIN-bump check: no main/origin/main ref found')
    return
  }

  for (const spec of PROTOCOLS) {
    const absolute = join(ROOT, spec.file)
    const current = readMinConst(readFileSync(absolute, 'utf8'), spec.minConst)
    const baseRaw = git(`show ${base}:${spec.file}`)
    if (current === null || baseRaw === null) {
      continue
    }
    const previous = readMinConst(baseRaw, spec.minConst)
    if (previous === null || current <= previous) {
      continue
    }

    // MIN was raised. Demand a BREAKING marker in the commit range or the
    // env-var escape hatch (useful when running this check on main itself).
    //
    // A shallow checkout truncates that range to the tip, so the marker is
    // simply not present to be found — "no marker written" and "no history to
    // read" are different answers and only the first is the author's fault.
    // Skip rather than accuse, the same way a missing base ref is handled. CI
    // checks out full history (`fetch-depth: 0`) so it still enforces this.
    if (git('rev-parse --is-shallow-repository')?.trim() === 'true') {
      console.warn(
        `[discipline] skipping MIN-bump check for ${spec.label}: shallow checkout, commit range unreadable`
      )
      continue
    }
    const commitMessages = git(`log --format=%B ${base}..HEAD`) ?? ''

    const envReason = process.env.AIMUX_PROTOCOL_BREAKING_REASON ?? ''
    if (BREAKING_MARKER.test(commitMessages) || BREAKING_MARKER.test(envReason)) {
      console.log(
        `[discipline] ${spec.label}: ${spec.minConst} raised ${previous} → ${current} with BREAKING marker — OK`
      )
      continue
    }

    findings.push({
      hint: `Add a 'BREAKING: <reason>' line to a commit on this branch (or export AIMUX_PROTOCOL_BREAKING_REASON='BREAKING: <reason>' when running locally). See src/ipc/README.md for when MIN actually needs to rise.`,
      message: `${spec.label}: ${spec.minConst} raised ${previous} → ${current} but no BREAKING: marker found in commits since ${base.slice(0, 7)}.`,
      rule: 'min-version-discipline',
    })
  }
}

function checkStopTerminalManagerCallers(): void {
  // Use `git ls-files` so we honour .gitignore and skip node_modules.
  const tracked =
    git('ls-files -- "*.ts" "*.tsx"')
      ?.split('\n')
      .filter((f) => f.length > 0)
      .filter((f) => !f.startsWith('test/') && !f.startsWith('scripts/')) ?? []

  for (const file of tracked) {
    if (STOP_TM_ALLOWED_FILES.has(file)) continue
    const absolute = join(ROOT, file)
    let content: string
    try {
      content = readFileSync(absolute, 'utf8')
    } catch {
      continue
    }
    if (!content.includes('stopTerminalManager(')) continue

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      // Match only calls, not the function declaration itself.
      if (!/\bstopTerminalManager\s*\(/.test(line)) continue
      if (/\bfunction\s+stopTerminalManager\b/.test(line)) continue

      // Marker can be on the call line or any of the preceding lookback
      // lines (lets a short explanatory paragraph precede the call).
      let hasMarker = line.includes(STOP_TM_OPT_IN_MARKER)
      for (let j = 1; !hasMarker && j <= STOP_TM_MARKER_LOOKBACK && i - j >= 0; j++) {
        if ((lines[i - j] ?? '').includes(STOP_TM_OPT_IN_MARKER)) hasMarker = true
      }
      if (hasMarker) continue

      findings.push({
        hint: `If killing every PTY is intentional, add a comment containing '${STOP_TM_OPT_IN_MARKER}' on the call line or within ${STOP_TM_MARKER_LOOKBACK} lines above it. Otherwise move the work into src/restart-terminal-manager.ts or replace it with the reexec path (see docs/developer/hot-reexec.md).`,
        message: `${file}:${i + 1}: unmarked stopTerminalManager() call — this kills every running PTY.`,
        rule: 'stop-terminal-manager-discipline',
      })
    }
  }
}

function checkTerminalManagerPluginImports(): void {
  const tracked =
    git('ls-files -- "src/terminal-manager/*.ts" "src/terminal-manager/*.tsx"')
      ?.split('\n')
      .filter((f) => f.length > 0) ?? []

  for (const file of tracked) {
    if (!file.startsWith(TM_PREFIX)) continue
    let content: string
    try {
      content = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (!PLUGIN_IMPORT.test(line)) continue
      findings.push({
        hint: 'Move the shared code into a module neither process owns, or reach the plugin kernel through the daemon. See docs/developer/plugins.md.',
        message: `${file}:${i + 1}: the terminal manager must not import the plugin kernel.`,
        rule: 'terminal-manager-plugin-isolation',
      })
    }
  }
}

function main(): void {
  checkMinBumps()
  checkStopTerminalManagerCallers()
  checkTerminalManagerPluginImports()

  if (findings.length === 0) {
    console.log('[discipline] OK')
    return
  }

  for (const finding of findings) {
    console.error(`\n[31m✗ ${finding.rule}[0m`)
    console.error(`  ${finding.message}`)
    console.error(`  fix: ${finding.hint}`)
  }
  console.error(`\n${findings.length} discipline violation(s). See src/ipc/README.md.`)
  process.exit(1)
}

main()
