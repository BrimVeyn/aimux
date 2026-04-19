import type { GitFileEntry, GitRefreshPayload } from '../state/types'

import { diffHash } from '../git/diff-hash'

function fileKey(f: GitFileEntry): string {
  return [f.path, f.status, f.section, f.added ?? '∅', f.removed ?? '∅'].join('|')
}

export function workingTreeHash(payload: GitRefreshPayload): string {
  const sortedFiles = [...payload.files].sort((x, y) => {
    const kx = fileKey(x)
    const ky = fileKey(y)
    if (kx < ky) return -1
    if (kx > ky) return 1
    return 0
  })
  const body = [
    payload.branch ?? '∅',
    String(payload.ahead),
    String(payload.behind),
    sortedFiles.map(fileKey).join('\n'),
  ].join('\n---\n')
  return diffHash(body)
}
