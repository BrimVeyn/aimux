#!/usr/bin/env bun
/* eslint-disable no-console -- release CLI: console is the UI */
// Cut a new release: bump the root `@brimveyn/aimux` package and optionally
// `@brimveyn/aimux-config`, commit, tag, push.
//
// Usage: bun bump <root-kind> [config-kind]
//
// - root-kind:   major | minor | patch        (required)
// - config-kind: major | minor | patch | none (optional, default: none)

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type BumpKind = 'major' | 'minor' | 'patch'
type ConfigArg = BumpKind | 'none'

const ROOT = new URL('..', import.meta.url).pathname
const ROOT_PKG = join(ROOT, 'package.json')
const CONFIG_PKG = join(ROOT, 'packages/aimux-config/package.json')

function fail(msg: string): never {
  console.error(`\u001b[31merror\u001b[0m: ${msg}`)
  process.exit(1)
}

function sh(cmd: string, args: string[], opts: { capture?: boolean } = {}): string {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  })
  if (res.status !== 0) {
    fail(`\`${cmd} ${args.join(' ')}\` exited ${res.status ?? 'null'}`)
  }
  return (res.stdout ?? '').trim()
}

function parseKind(raw: string | undefined, label: string): BumpKind {
  if (raw === 'major' || raw === 'minor' || raw === 'patch') return raw
  fail(`${label}: expected one of major, minor, patch`)
}

function parseConfigArg(raw: string | undefined): ConfigArg {
  if (raw === undefined || raw === 'none') return 'none'
  return parseKind(raw, 'config-kind')
}

function bump(version: string, kind: BumpKind, label: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) fail(`${label}: non-semver version "${version}"`)
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function readPackage(path: string): { name: string; version: string; raw: string } {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as { name: string; version: string }
  return { name: parsed.name, raw, version: parsed.version }
}

function rewriteVersion(raw: string, next: string): string {
  const updated = raw.replace(
    /("version"\s*:\s*")[^"]+(")/,
    (_m, a: string, b: string) => `${a}${next}${b}`
  )
  if (updated === raw) fail('failed to rewrite version string')
  return updated
}

function requireCleanTree(): void {
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (status.status !== 0) fail('`git status` failed')
  if ((status.stdout ?? '').trim() !== '') {
    fail('working tree has uncommitted changes — commit or stash them first')
  }
}

function currentBranch(): string {
  return sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true })
}

function tagExists(tag: string): boolean {
  const res = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
    cwd: ROOT,
  })
  return res.status === 0
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    fail('cannot prompt for confirmation without a TTY (run interactively)')
  }
  process.stdout.write(`${question} [y/N] `)
  process.stdin.setEncoding('utf8')
  const answer = await new Promise<string>((resolve) => {
    const onData = (chunk: string) => {
      process.stdin.off('data', onData)
      resolve(chunk)
    }
    process.stdin.on('data', onData)
  })
  return /^\s*y(es)?\s*$/i.test(answer)
}

const USAGE = `Usage: bun bump <root-kind> [config-kind]

  bun bump patch              # only root
  bun bump minor patch        # root minor + aimux-config patch
  bun bump major major        # both major
  bun bump patch none         # explicit: root only
`

async function main() {
  const firstArg = process.argv[2]
  if (firstArg === undefined || firstArg === '-h' || firstArg === '--help') {
    process.stdout.write(USAGE)
    process.exit(firstArg === undefined ? 1 : 0)
  }
  const rootKind = parseKind(firstArg, 'root-kind')
  const configArg = parseConfigArg(process.argv[3])

  requireCleanTree()

  const rootPkg = readPackage(ROOT_PKG)
  const rootPrev = rootPkg.version
  const rootNext = bump(rootPrev, rootKind, 'root package')
  const tag = `v${rootNext}`
  if (tagExists(tag)) fail(`tag ${tag} already exists`)

  let configPlan: { prev: string; next: string; name: string; raw: string } | null = null
  if (configArg !== 'none') {
    const configPkg = readPackage(CONFIG_PKG)
    configPlan = {
      name: configPkg.name,
      next: bump(configPkg.version, configArg, 'aimux-config'),
      prev: configPkg.version,
      raw: configPkg.raw,
    }
  }

  const branch = currentBranch()
  console.log(
    `\u001b[36m${rootPkg.name}\u001b[0m ${rootPrev} → \u001b[32m${rootNext}\u001b[0m (${rootKind})`
  )
  if (configPlan) {
    console.log(
      `\u001b[36m${configPlan.name}\u001b[0m ${configPlan.prev} → \u001b[32m${configPlan.next}\u001b[0m (${configArg})`
    )
  } else {
    console.log('aimux-config: not bumped')
  }
  console.log(`branch: ${branch}`)
  console.log('will:')
  let step = 1
  console.log(`  ${step++}. rewrite package.json version → ${rootNext}`)
  if (configPlan) {
    console.log(`  ${step++}. rewrite packages/aimux-config/package.json → ${configPlan.next}`)
  }
  console.log(`  ${step++}. bun install (sync lockfile)`)
  console.log(`  ${step++}. commit "chore(release): ${tag}"`)
  console.log(`  ${step++}. create annotated tag ${tag}`)
  console.log(`  ${step++}. push ${branch} and ${tag} to origin`)

  const ok = await confirm('proceed?')
  if (!ok) {
    console.log('aborted.')
    process.exit(1)
  }

  writeFileSync(ROOT_PKG, rewriteVersion(rootPkg.raw, rootNext))
  if (configPlan) {
    writeFileSync(CONFIG_PKG, rewriteVersion(configPlan.raw, configPlan.next))
  }

  // Sync workspace lockfile so the release commit is self-contained.
  sh('bun', ['install'])

  const stageFiles = ['package.json', 'bun.lock']
  if (configPlan) stageFiles.push('packages/aimux-config/package.json')
  sh('git', ['add', ...stageFiles])

  const commitMsg = configPlan
    ? `chore(release): ${tag} (aimux-config v${configPlan.next})`
    : `chore(release): ${tag}`
  sh('git', ['commit', '-m', commitMsg])
  sh('git', ['tag', '-a', tag, '-m', `Release ${tag}`])

  console.log(`pushing ${branch} and ${tag}…`)
  sh('git', ['push', 'origin', branch])
  sh('git', ['push', 'origin', tag])

  console.log(`\u001b[32m✔\u001b[0m released ${tag}`)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
