#!/usr/bin/env bun
/* eslint-disable no-console -- release CLI: console is the UI */
// Cut a new release: bump the root `@brimveyn/aimux` package and, optionally,
// either published workspace package; commit, tag, push.
//
// Usage: bun bump <root-kind> [config-kind] [plugin-kind]
//
// - root-kind:   major | minor | patch        (required)
// - config-kind: major | minor | patch | none (optional, default: none)
// - plugin-kind: major | minor | patch | none (optional, default: none)

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type BumpKind = 'major' | 'minor' | 'patch'
type ConfigArg = BumpKind | 'none'

const ROOT = new URL('..', import.meta.url).pathname
const ROOT_PKG = join(ROOT, 'package.json')
const CONFIG_PKG = join(ROOT, 'packages/aimux-config/package.json')
const PLUGIN_PKG = join(ROOT, 'packages/aimux-plugin/package.json')

/**
 * The workspace packages that are published, and the source directory whose
 * changes mean the package has to go up with the release. Both are `workspace:*`
 * dependencies of the app, which resolves to whatever npm has — so a package
 * that moved and was not bumped ships an app pinned to a stale copy.
 */
interface WorkspacePackage {
  slug: string
  manifest: string
  src: string
}

const WORKSPACE_PACKAGES: readonly WorkspacePackage[] = [
  { manifest: CONFIG_PKG, slug: 'aimux-config', src: 'packages/aimux-config/src' },
  { manifest: PLUGIN_PKG, slug: 'aimux-plugin', src: 'packages/aimux-plugin/src' },
]
const LOCKFILE = join(ROOT, 'bun.lock')

function fail(msg: string): never {
  console.error(`\u001b[31merror\u001b[0m: ${msg}`)
  process.exit(1)
}

function sh(
  cmd: string,
  args: string[],
  opts: { capture?: boolean; env?: Record<string, string> } = {}
): string {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: opts.capture === true ? ['inherit', 'pipe', 'pipe'] : 'inherit',
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

/**
 * Surgically update one workspace entry's version in bun.lock. We intentionally
 * do NOT regenerate the lockfile during a release: a full regen would re-resolve
 * every dependency, potentially dragging in unrelated upstream updates into a
 * release commit.
 */
function rewriteLockfileWorkspaceVersion(raw: string, slug: string, next: string): string {
  const pattern = new RegExp(`("packages/${slug}"\\s*:\\s*\\{[^}]*?"version"\\s*:\\s*")[^"]+(")`)
  const updated = raw.replace(pattern, (_m, a: string, b: string) => `${a}${next}${b}`)
  if (updated === raw) fail(`could not locate ${slug} version entry in bun.lock`)
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

/**
 * Refuse a root-only release when `packages/aimux-config/src` has moved since
 * the last commit that touched its package.json — i.e. since the version npm
 * has. `workspace:*` resolves to that published version, so shipping like this
 * pairs a new app with an old config package: v1.23.1 shipped the settings
 * rewrite against aimux-config 0.10.2, whose keymap still bound `h`/`←` to a
 * pane that no longer existed, and the whole screen went dead to the arrows.
 */
function requirePackageReleased(pkg: WorkspacePackage, version: string, argName: string): void {
  const lastRelease = sh('git', ['log', '-1', '--format=%H', '--', pkg.manifest], { capture: true })
  if (lastRelease === '') return
  const diff = spawnSync('git', ['diff', '--quiet', lastRelease, '--', pkg.src], { cwd: ROOT })
  if (diff.status === 0) return
  fail(
    `${pkg.src} changed since v${version} was cut — pass a ${argName} ` +
      `(e.g. \`bun bump patch patch patch\`), or the release ships against the published ${version}`
  )
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
  if (process.stdin.isTTY !== true) {
    fail('cannot prompt for confirmation without a TTY (run interactively)')
  }
  process.stdout.write(`${question} [y/N] `)
  process.stdin.setEncoding('utf8')
  const answer = await new Promise<string>((resolve) => {
    const onData = (chunk: string) => {
      process.stdin.off('data', onData)
      // Dropping the listener does not stop the stream: a TTY never EOFs, so a
      // resumed stdin stays a live handle and the process hangs after the last
      // push instead of exiting. This is the Ctrl-C everyone was typing at the
      // end of a release.
      process.stdin.pause()
      resolve(chunk)
    }
    process.stdin.on('data', onData)
  })
  return /^\s*y(es)?\s*$/i.test(answer)
}

const USAGE = `Usage: bun bump <root-kind> [config-kind] [plugin-kind]

  bun bump patch                # only root
  bun bump minor patch          # root minor + aimux-config patch
  bun bump patch none patch     # root + aimux-plugin, leaving aimux-config
  bun bump major major major    # all three
  bun bump patch none none      # explicit: root only
`

async function main() {
  const firstArg = process.argv[2]
  if (firstArg === undefined || firstArg === '-h' || firstArg === '--help') {
    process.stdout.write(USAGE)
    process.exit(firstArg === undefined ? 1 : 0)
  }
  const rootKind = parseKind(firstArg, 'root-kind')
  const kindArgs: ConfigArg[] = [parseConfigArg(process.argv[3]), parseConfigArg(process.argv[4])]

  requireCleanTree()

  const rootPkg = readPackage(ROOT_PKG)
  const rootPrev = rootPkg.version
  const rootNext = bump(rootPrev, rootKind, 'root package')
  const tag = `v${rootNext}`
  if (tagExists(tag)) fail(`tag ${tag} already exists`)

  interface PackagePlan extends WorkspacePackage {
    name: string
    prev: string
    next: string
    raw: string
    kind: BumpKind
  }

  const plans: PackagePlan[] = []
  for (const [index, pkg] of WORKSPACE_PACKAGES.entries()) {
    const kind = kindArgs[index] ?? 'none'
    const current = readPackage(pkg.manifest)
    if (kind === 'none') {
      requirePackageReleased(pkg, current.version, `${pkg.slug.replace('aimux-', '')}-kind`)
      continue
    }
    plans.push({
      ...pkg,
      kind,
      name: current.name,
      next: bump(current.version, kind, pkg.slug),
      prev: current.version,
      raw: current.raw,
    })
  }

  const branch = currentBranch()
  console.log(
    `\u001b[36m${rootPkg.name}\u001b[0m ${rootPrev} → \u001b[32m${rootNext}\u001b[0m (${rootKind})`
  )
  for (const pkg of WORKSPACE_PACKAGES) {
    const plan = plans.find((entry) => entry.slug === pkg.slug)
    if (plan) {
      console.log(
        `\u001b[36m${plan.name}\u001b[0m ${plan.prev} → \u001b[32m${plan.next}\u001b[0m (${plan.kind})`
      )
    } else {
      console.log(`${pkg.slug}: not bumped`)
    }
  }
  console.log(`branch: ${branch}`)
  const bumped = plans.map((plan) => `${plan.slug} v${plan.next}`).join(', ')
  const commitMsg = bumped === '' ? `chore(release): ${tag}` : `chore(release): ${tag} (${bumped})`
  console.log('will:')
  let step = 1
  console.log(`  ${step++}. run pre-push checks (lint, format, typecheck, test)`)
  console.log(`  ${step++}. rewrite package.json version → ${rootNext}`)
  for (const plan of plans) {
    console.log(`  ${step++}. rewrite packages/${plan.slug}/package.json → ${plan.next}`)
    console.log(`  ${step++}. patch ${plan.slug} version in bun.lock → ${plan.next}`)
  }
  console.log(`  ${step++}. commit "${commitMsg}"`)
  console.log(`  ${step++}. create annotated tag ${tag}`)
  console.log(`  ${step++}. push ${branch} and ${tag} to origin`)

  const ok = await confirm('proceed?')
  if (!ok) {
    console.log('aborted.')
    process.exit(1)
  }

  // Run the pre-push suite BEFORE mutating anything: a failing test used to
  // surface only at `git push`, by which point the version bump was already
  // written, committed and tagged — so retrying skipped a version.
  console.log('running pre-push checks…')
  sh('bunx', ['lefthook', 'run', 'pre-push'])

  writeFileSync(ROOT_PKG, rewriteVersion(rootPkg.raw, rootNext))
  const stageFiles = ['package.json']
  for (const plan of plans) {
    writeFileSync(plan.manifest, rewriteVersion(plan.raw, plan.next))
    // Patch bun.lock in place. `bun pack` resolves `workspace:*` by reading
    // the workspace entry's version from the lockfile — if that entry is
    // stale, the published tarball pins the wrong version.
    const lockRaw = readFileSync(LOCKFILE, 'utf8')
    writeFileSync(LOCKFILE, rewriteLockfileWorkspaceVersion(lockRaw, plan.slug, plan.next))
    stageFiles.push(`packages/${plan.slug}/package.json`, 'bun.lock')
  }
  sh('git', ['add', ...stageFiles])
  sh('git', ['commit', '-m', commitMsg])
  sh('git', ['tag', '-a', tag, '-m', `Release ${tag}`])

  console.log(`pushing ${branch} and ${tag}…`)
  // LEFTHOOK=0: the pre-push suite already ran above on the same tree.
  sh('git', ['push', 'origin', branch], { env: { LEFTHOOK: '0' } })
  sh('git', ['push', 'origin', tag], { env: { LEFTHOOK: '0' } })

  console.log(`\u001b[32m✔\u001b[0m released ${tag}`)
}

try {
  await main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
