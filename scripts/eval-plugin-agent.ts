#!/usr/bin/env bun
/* eslint-disable no-console -- an eval harness whose output is its report */
/**
 * The half of phase 8's acceptance test that an assertion cannot cover: can an
 * agent, given the bare request and nothing else, actually get there?
 *
 * `test/integration/plugin-agent-loop.test.ts` proves the *capability* — a
 * plugin that declares where its widget goes and which key runs its action is
 * placed, drawable, bound, runnable and reversible, with no config edit and no
 * restart. It cannot prove that a model finds that path, because that is a
 * prompt, not an assertion.
 *
 * So this is deliberately not a test file and not wired into CI: it spends a
 * real session on every run, and a suite that costs money per push is a suite
 * people turn off. Run it by hand when the API or the skill changes:
 *
 *     bun run scripts/eval-plugin-agent.ts
 *     bun run scripts/eval-plugin-agent.ts --agent 'codex exec' --keep
 *
 * What it checks is what an agent can be wrong about on its own — the plugin
 * exists, the manifest validates, `doctor` loads both halves, and the keys and
 * placement are declared rather than left in a sentence telling the user to
 * edit `aimux.config.ts`. What it cannot check unattended is the screen: that
 * needs a running aimux, and `aimux ui state` is the command for it.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = new URL('..', import.meta.url).pathname
const AIMUX = join(REPO, 'src/index.tsx')

/** The request, as a user would type it. No hints, no file list, no API notes. */
const PROMPT = `Crée un plugin aimux dans ce dossier : une "boîte de vitesses" qui change le
modèle de l'assistant actif. Cinq vitesses, une tuile dans la status bar qui
montre la vitesse courante, et deux raccourcis clavier pour monter et descendre.
Le plugin doit fonctionner dès qu'il est lié, sans que j'aie à éditer ma
configuration ni à relancer aimux.`

interface Check {
  name: string
  passed: boolean
  detail?: string
}

function run(cmd: string[], cwd: string, timeoutMs = 600_000): { code: number; out: string } {
  const proc = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, AIMUX_PLUGIN_WATCH: '0' },
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: timeoutMs,
  })
  return {
    code: proc.exitCode ?? 1,
    out: `${proc.stdout.toString()}${proc.stderr.toString()}`,
  }
}

/** The first directory under `root` holding a manifest — wherever the agent put it. */
function findPlugin(root: string): string | null {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    // Explicit comparisons throughout: `scripts/` is outside the tsconfig
    // include, so the type-aware lint sees `any` here and a bare truthiness
    // check is a rule violation rather than a style choice.
    if (existsSync(join(dir, 'aimux-plugin.json')) === true) return dir
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() !== true) continue
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      stack.push(join(dir, entry.name))
    }
  }
  return null
}

const args = process.argv.slice(2)
const agent =
  args.includes('--agent') === true ? (args[args.indexOf('--agent') + 1] ?? '') : 'claude -p'
const keep = args.includes('--keep') === true

const workdir = mkdtempSync(join(tmpdir(), 'aimux-plugin-eval-'))
console.log(`workdir: ${workdir}`)
console.log(`agent:   ${agent}`)

const started = Date.now()
const session = run([...agent.split(' '), PROMPT], workdir)
const elapsedMs = Date.now() - started
console.log(`agent exited ${session.code} after ${Math.round(elapsedMs / 1000)}s`)

const checks: Check[] = []
const root = findPlugin(workdir)
checks.push({
  detail: root ?? 'no aimux-plugin.json anywhere under the workdir',
  name: 'the agent produced a plugin',
  passed: root !== null,
})

if (root !== null) {
  const manifest = JSON.parse(readFileSync(join(root, 'aimux-plugin.json'), 'utf8')) as {
    contributes?: { bars?: unknown[]; keymaps?: unknown[] }
    entries?: Record<string, string>
  }

  const doctor = run(['bun', 'run', AIMUX, 'plugin', 'doctor', root], REPO)
  let report: {
    ok?: boolean
    halves?: { host: string; registrations: Record<string, unknown> }[]
  } = {}
  try {
    report = JSON.parse(doctor.out) as typeof report
  } catch {
    report = {}
  }

  checks.push({
    detail: doctor.out.slice(0, 400),
    name: 'plugin doctor says it loads',
    passed: report.ok === true,
  })

  const registered = (report.halves ?? []).flatMap((half) => [
    ...((half.registrations.statusBarSegments as string[] | undefined) ?? []),
    ...((half.registrations.widgets as string[] | undefined) ?? []),
  ])
  checks.push({
    detail: registered.join(', '),
    name: 'it draws something (a tile or a widget)',
    passed: registered.length > 0,
  })

  const actions = (report.halves ?? []).flatMap(
    (half) => (half.registrations.actions as string[] | undefined) ?? []
  )
  checks.push({
    detail: actions.join(', '),
    name: 'it registers actions to bind',
    passed: actions.length >= 2,
  })

  // The phase-8 point: the plugin asks for its own keys instead of ending with
  // "now add this to your aimux.config.ts and restart".
  checks.push({
    detail: JSON.stringify(manifest.contributes ?? null),
    name: 'it declares its own keybindings in the manifest',
    passed: (manifest.contributes?.keymaps?.length ?? 0) >= 2,
  })
}

const passed = checks.every((check) => check.passed)
console.log(`\n${passed ? 'PASS' : 'FAIL'}`)
for (const check of checks) {
  console.log(`  ${check.passed ? '✔' : '✘'} ${check.name}`)
  if (!check.passed && check.detail !== undefined) console.log(`      ${check.detail}`)
}
console.log(
  `\n${JSON.stringify({ agent, checks, elapsedMs, passed, workdir: keep ? workdir : null })}`
)

if (!keep) rmSync(workdir, { force: true, recursive: true })
else console.log(`\nkept: ${workdir}`)

process.exit(passed ? 0 : 1)
