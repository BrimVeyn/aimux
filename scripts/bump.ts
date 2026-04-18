#!/usr/bin/env bun
/* eslint-disable no-console -- release CLI: console is the UI */
// Cut a new release of the root `@brimveyn/aimux` package:
// bump version → commit → tag → push (branch + tag).
//
// Usage: bun bump <major | minor | patch>

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type BumpKind = 'major' | 'minor' | 'patch'

const ROOT = new URL('..', import.meta.url).pathname
const PKG_PATH = join(ROOT, 'package.json')

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

function parseKind(raw: string | undefined): BumpKind {
  if (raw === 'major' || raw === 'minor' || raw === 'patch') return raw
  fail('expected one of: major, minor, patch')
}

function bump(version: string, kind: BumpKind): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) fail(`root package.json has non-semver version "${version}"`)
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
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
    fail('cannot prompt for confirmation without a TTY (pipe `yes` or run interactively)')
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

async function main() {
  const kind = parseKind(process.argv[2])

  requireCleanTree()

  const pkgRaw = readFileSync(PKG_PATH, 'utf8')
  const pkg = JSON.parse(pkgRaw) as { version: string; name: string }
  const prev = pkg.version
  const next = bump(prev, kind)
  const tag = `v${next}`

  if (tagExists(tag)) fail(`tag ${tag} already exists`)

  const branch = currentBranch()
  console.log(`\u001b[36m${pkg.name}\u001b[0m ${prev} → \u001b[32m${next}\u001b[0m (${kind})`)
  console.log(`branch: ${branch}`)
  console.log('will:')
  console.log(`  1. rewrite package.json version → ${next}`)
  console.log('  2. bun install (sync lockfile)')
  console.log(`  3. commit "chore(release): ${tag}"`)
  console.log(`  4. create annotated tag ${tag}`)
  console.log(`  5. push ${branch} and ${tag} to origin`)

  const ok = await confirm('proceed?')
  if (!ok) {
    console.log('aborted.')
    process.exit(1)
  }

  // Update package.json: preserve trailing newline + JSON formatting (2-space).
  const updated = pkgRaw.replace(
    /("version"\s*:\s*")[^"]+(")/,
    (_m, a: string, b: string) => `${a}${next}${b}`
  )
  if (updated === pkgRaw) fail('failed to rewrite version string in package.json')
  writeFileSync(PKG_PATH, updated)

  // Sync workspace lockfile so the release commit is self-contained.
  sh('bun', ['install'])

  // Stage + commit. We only stage known files to avoid sweeping in stray state.
  sh('git', ['add', 'package.json', 'bun.lock'])
  sh('git', ['commit', '-m', `chore(release): ${tag}`])
  sh('git', ['tag', '-a', tag, '-m', `Release ${tag}`])

  console.log(`pushing ${branch} and ${tag}…`)
  sh('git', ['push', 'origin', branch])
  sh('git', ['push', 'origin', tag])

  console.log(`\u001b[32m✔\u001b[0m released ${tag}`)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
