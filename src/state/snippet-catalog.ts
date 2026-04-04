import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CONFIG_PATH } from '../config'
import { logDebug } from '../debug/input-log'
import { isSnippetRecord } from './validation'

export interface SnippetRecord {
  id: string
  name: string
  content: string
}

const SNIPPETS_PATH = join(dirname(CONFIG_PATH), 'aimux-snippets.json')

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
    if (parsed.version !== 1 || !Array.isArray(parsed.snippets)) {
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
    return parsed.snippets
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
    mkdirSync(dirname(SNIPPETS_PATH), { recursive: true })
    writeFileSync(SNIPPETS_PATH, `${JSON.stringify({ snippets, version: 1 }, null, 2)}\n`)
  } catch (error) {
    logDebug('snippets.catalog.saveError', {
      error: error instanceof Error ? error.message : String(error),
      path: SNIPPETS_PATH,
      snippetCount: snippets.length,
    })
  }
}
