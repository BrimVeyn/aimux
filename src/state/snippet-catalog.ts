import type { SnippetDef, SnippetVar } from '@brimveyn/aimux-config'

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { isSnippetRecord } from './validation'

export interface SnippetRecord {
  id: string
  name: string
  content: string
  trigger?: string
  vars?: Record<string, SnippetVar>
}

export function getSnippetsCatalogPath(): string {
  return join(getProfileConfigDir(), 'aimux-snippets.json')
}

const SNIPPETS_PATH = getSnippetsCatalogPath()

const DEFAULT_SNIPPETS: SnippetRecord[] = [
  {
    content: 'Review this code for bugs, security issues, and suggest improvements.',
    id: 'default-review',
    name: 'Code review',
  },
  {
    content: 'Explain how this code works step by step.',
    id: 'default-explain',
    name: 'Explain',
  },
  {
    content: 'Write comprehensive unit tests for this code with edge cases.',
    id: 'default-tests',
    name: 'Write tests',
  },
  {
    content:
      'Refactor this code to improve readability and maintainability without changing behavior.',
    id: 'default-refactor',
    name: 'Refactor',
  },
  {
    content: 'Analyze this error and provide a fix with explanation.',
    id: 'default-fix',
    name: 'Fix error',
  },
]

export function loadSnippetCatalog(): SnippetRecord[] {
  try {
    if (!existsSync(SNIPPETS_PATH)) {
      saveSnippetCatalog(DEFAULT_SNIPPETS)
      return DEFAULT_SNIPPETS
    }
    const parsed = JSON.parse(readFileSync(SNIPPETS_PATH, 'utf8')) as {
      version?: unknown
      snippets?: unknown
    }
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.snippets)) {
      logDebug('snippets.catalog.loadIssue', {
        issue: 'invalid snippet catalog header',
        path: SNIPPETS_PATH,
      })
      return []
    }
    if (!parsed.snippets.every(isSnippetRecord)) {
      logDebug('snippets.catalog.loadIssue', {
        issue: 'invalid snippet catalog entries',
        path: SNIPPETS_PATH,
      })
      return []
    }
    return parsed.snippets.map(stripUserVars)
  } catch (error) {
    logDebug('snippets.catalog.loadIssue', {
      issue: error instanceof Error ? error.message : String(error),
      path: SNIPPETS_PATH,
    })
    return []
  }
}

export function saveSnippetCatalog(snippets: SnippetRecord[]): void {
  try {
    mkdirSync(getProfileConfigDir(), { recursive: true })
    // Persist only user-owned snippets. Config-pinned entries are reapplied
    // at boot from `aimux.config.ts`.
    const userSnippets = snippets.filter((s) => !isConfigSnippetId(s.id)).map(stripUserVars)
    // Schema v2 adds the optional `trigger` and `vars` fields. v1 files are
    // still accepted on read (they validate as v2 — both fields are optional)
    // and get rewritten as v2 on the next save.
    writeFileSync(
      SNIPPETS_PATH,
      `${JSON.stringify({ snippets: userSnippets, version: 2 }, null, 2)}\n`
    )
  } catch (error) {
    logDebug('snippets.catalog.saveError', {
      error: error instanceof Error ? error.message : String(error),
      path: SNIPPETS_PATH,
      snippetCount: snippets.length,
    })
  }
}

export const CONFIG_SNIPPET_ID_PREFIX = 'config:'

export function isConfigSnippetId(id: string): boolean {
  return id.startsWith(CONFIG_SNIPPET_ID_PREFIX)
}

/**
 * Shell `vars` are only authorized on config-pinned snippets (those defined in
 * `aimux.config.ts`). If they ever appear on a user-edited JSON snippet — by
 * hand edit, restore, or import — strip them. This keeps shell execution
 * gated by the user's TypeScript config file.
 *
 * Exported for testing; called at both load and save time.
 */
export function stripUserVars(snippet: SnippetRecord): SnippetRecord {
  if (snippet.vars === undefined) return snippet
  if (isConfigSnippetId(snippet.id)) return snippet
  logDebug('snippets.catalog.strippedVars', { id: snippet.id, name: snippet.name })
  const { vars, ...clean } = snippet
  void vars
  return clean
}

/**
 * Merge config-defined snippets with user-edited snippets.
 * Config-pinned snippets ("sticky") get a stable id `config:${name}` and win
 * over a user-edited snippet with the same id (they're read-only in the UI).
 */
export function mergeConfigSnippets(
  userSnippets: readonly SnippetRecord[],
  configSnippets: readonly SnippetDef[]
): SnippetRecord[] {
  const fromConfig: SnippetRecord[] = configSnippets.map((s) => ({
    content: s.text,
    id: `${CONFIG_SNIPPET_ID_PREFIX}${s.name}`,
    name: s.name,
    trigger: s.trigger,
    vars: s.vars,
  }))
  const configIds = new Set(fromConfig.map((s) => s.id))
  const userKept = userSnippets.filter((s) => !configIds.has(s.id))
  return [...fromConfig, ...userKept]
}
