import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OVERRIDE_FILENAME = 'auto-commit-prompt.md'
const DEFAULT_PATH = new URL('./default-auto-commit-prompt.md', import.meta.url)

export interface LoadOptions {
  profileConfigRoot: string
}

export async function loadBriefingTemplate(opts: LoadOptions): Promise<string> {
  const override = join(opts.profileConfigRoot, OVERRIDE_FILENAME)
  if (existsSync(override)) {
    return await readFile(override, 'utf8')
  }
  return await readFile(DEFAULT_PATH, 'utf8')
}

export interface PromptSlots {
  recentCommits: string
  diff: string
}

export function composePromptFromTemplate(template: string, slots: PromptSlots): string {
  return template
    .replaceAll('{recentCommits}', slots.recentCommits)
    .replaceAll('{diff}', slots.diff)
}
