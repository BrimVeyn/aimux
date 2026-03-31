import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CONFIG_PATH } from '../config'

export interface SnippetRecord {
  id: string
  name: string
  content: string
}

interface SnippetCatalogFile {
  version: 1
  snippets: SnippetRecord[]
}

const SNIPPETS_PATH = join(dirname(CONFIG_PATH), 'aimux-snippets.json')

const DEFAULT_SNIPPETS: SnippetRecord[] = [
  {
    id: 'default-review',
    name: 'Code review',
    content: 'Review this code for bugs, security issues, and suggest improvements.',
  },
  {
    id: 'default-explain',
    name: 'Explain',
    content: 'Explain how this code works step by step.',
  },
  {
    id: 'default-tests',
    name: 'Write tests',
    content: 'Write comprehensive unit tests for this code with edge cases.',
  },
  {
    id: 'default-refactor',
    name: 'Refactor',
    content:
      'Refactor this code to improve readability and maintainability without changing behavior.',
  },
  {
    id: 'default-fix',
    name: 'Fix error',
    content: 'Analyze this error and provide a fix with explanation.',
  },
]

export function loadSnippetCatalog(): SnippetRecord[] {
  try {
    if (!existsSync(SNIPPETS_PATH)) {
      saveSnippetCatalog(DEFAULT_SNIPPETS)
      return DEFAULT_SNIPPETS
    }
    const parsed = JSON.parse(readFileSync(SNIPPETS_PATH, 'utf8')) as SnippetCatalogFile
    if (parsed.version !== 1 || !Array.isArray(parsed.snippets)) {
      return []
    }
    return parsed.snippets
  } catch {
    return []
  }
}

export function saveSnippetCatalog(snippets: SnippetRecord[]): void {
  try {
    mkdirSync(dirname(SNIPPETS_PATH), { recursive: true })
    writeFileSync(SNIPPETS_PATH, `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`)
  } catch {
    // ignore write errors
  }
}
