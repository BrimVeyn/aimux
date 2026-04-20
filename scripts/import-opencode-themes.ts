#!/usr/bin/env bun
/* eslint-disable no-console, typescript/no-non-null-assertion */
// Pulls every theme JSON from sst/opencode and emits a typed module at
// packages/aimux-config/src/themes/opencode.ts. Idempotent — re-run to refresh.
//
// Usage: bun scripts/import-opencode-themes.ts [--ref dev]

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'sst/opencode'
const PATH = 'packages/ui/src/theme/themes'
const DEFAULT_REF = 'dev'
const OUT = join(import.meta.dir, '..', 'packages', 'aimux-config', 'src', 'themes', 'opencode.ts')

const REQUIRED_TOKENS = [
  'neutral',
  'ink',
  'primary',
  'success',
  'warning',
  'error',
  'info',
] as const
const OPTIONAL_TOKENS = ['accent', 'interactive', 'diffAdd', 'diffDelete'] as const
type RequiredToken = (typeof REQUIRED_TOKENS)[number]
type OptionalToken = (typeof OPTIONAL_TOKENS)[number]
type Token = RequiredToken | OptionalToken

interface ThemeVariantJson {
  palette: Record<string, string>
}
interface ThemeFileJson {
  id: string
  name: string
  light?: ThemeVariantJson
  dark?: ThemeVariantJson
}

function parseRef(): string {
  const ix = process.argv.indexOf('--ref')
  return ix >= 0 ? (process.argv[ix + 1] ?? DEFAULT_REF) : DEFAULT_REF
}

async function listThemeFiles(ref: string): Promise<string[]> {
  // GitHub's HTML tree page is more rate-limit-tolerant than the contents API.
  const url = `https://github.com/${REPO}/tree/${ref}/${PATH}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  const html = await res.text()
  const matches = html.matchAll(/packages\/ui\/src\/theme\/themes\/([a-z0-9-]+)\.json/g)
  const slugs = new Set<string>()
  for (const m of matches) slugs.add(m[1]!)
  return [...slugs].sort()
}

async function fetchTheme(ref: string, slug: string): Promise<ThemeFileJson> {
  const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${PATH}/${slug}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return (await res.json()) as ThemeFileJson
}

function normalizeHex(value: string): string {
  let v = value.trim()
  if (!v.startsWith('#')) v = `#${v}`
  if (v.length === 4) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  if (v.length === 9) v = v.slice(0, 7)
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`bad hex: ${value}`)
  return v.toLowerCase()
}

function pickPalette(raw: Record<string, string>, slug: string, mode: string) {
  const out: Partial<Record<Token, string>> = {}
  for (const k of REQUIRED_TOKENS) {
    const raw_v = raw[k]
    if (!raw_v) throw new Error(`${slug} ${mode}: missing required token "${k}"`)
    out[k] = normalizeHex(raw_v)
  }
  for (const k of OPTIONAL_TOKENS) {
    const raw_v = raw[k]
    if (raw_v) out[k] = normalizeHex(raw_v)
  }
  return out as Record<RequiredToken, string> & Partial<Record<OptionalToken, string>>
}

function emitVariant(
  slug: string,
  mode: 'light' | 'dark',
  displayName: string,
  palette: ReturnType<typeof pickPalette>
): string {
  const id = `${slug}-${mode}`
  const tokens = [
    `    accent: ${palette.accent ? `'${palette.accent}'` : 'undefined'},`,
    `    diffAdd: ${palette.diffAdd ? `'${palette.diffAdd}'` : 'undefined'},`,
    `    diffDelete: ${palette.diffDelete ? `'${palette.diffDelete}'` : 'undefined'},`,
    `    error: '${palette.error}',`,
    `    info: '${palette.info}',`,
    `    ink: '${palette.ink}',`,
    `    interactive: ${palette.interactive ? `'${palette.interactive}'` : 'undefined'},`,
    `    neutral: '${palette.neutral}',`,
    `    primary: '${palette.primary}',`,
    `    success: '${palette.success}',`,
    `    warning: '${palette.warning}',`,
  ]
    .filter((line) => !line.includes(': undefined,'))
    .join('\n')
  return `  '${id}': {
    bg: '${palette.neutral}',
    displayName: '${displayName} ${mode === 'dark' ? 'Dark' : 'Light'}',
    fg: '${palette.ink}',
    mode: '${mode}',
    name: 'opencode:${slug}',
    palette: {
${tokens}
    },
  },`
}

async function main() {
  const ref = parseRef()
  console.log(`refreshing opencode themes from ${REPO}@${ref}`)
  const slugs = await listThemeFiles(ref)
  console.log(`found ${slugs.length} theme files`)

  const entries: string[] = []
  const ids: string[] = []
  let imported = 0
  let skipped = 0

  for (const slug of slugs) {
    let json: ThemeFileJson
    try {
      json = await fetchTheme(ref, slug)
    } catch (err) {
      console.warn(`  skip ${slug}: fetch failed (${(err as Error).message})`)
      skipped++
      continue
    }
    const display = (json.name ?? slug).replace(/'/g, "\\'")
    for (const mode of ['dark', 'light'] as const) {
      const variant = json[mode]
      if (!variant?.palette) continue
      try {
        const palette = pickPalette(variant.palette, slug, mode)
        entries.push(emitVariant(slug, mode, display, palette))
        ids.push(`'${slug}-${mode}'`)
        imported++
      } catch (err) {
        console.warn(`  skip ${slug}/${mode}: ${(err as Error).message}`)
        skipped++
      }
    }
  }

  const banner = `// AUTO-GENERATED — run \`bun scripts/import-opencode-themes.ts\` to regenerate.
// Source: https://github.com/${REPO}/tree/${ref}/${PATH}
// License: MIT (sst/opencode)
/* eslint-disable */

import type { AimuxTheme } from '../types'

export const OPENCODE_THEMES: Record<string, AimuxTheme> = {
${entries.join('\n')}
}

export const OPENCODE_THEME_IDS: string[] = [
  ${ids.join(',\n  ')},
]
`
  writeFileSync(OUT, banner)
  console.log(`wrote ${OUT}`)
  console.log(`imported ${imported} variants (skipped ${skipped})`)
}

await main()
