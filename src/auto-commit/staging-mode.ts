import type { GitRefreshPayload } from '../state/types'

export function hasStagedFiles(git: GitRefreshPayload): boolean {
  return git.files.some((f) => f.section === 'staged')
}
