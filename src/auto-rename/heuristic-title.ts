// Last-resort title, derived locally from the prompt when every model
// generation attempt failed (binary missing, non-zero exit, timeout,
// unusable output). A rough title beats a tab that stays "Claude" forever.

import { clampTitle } from './title-format'

/** Openers that carry no intent; dropped so the title starts at the verb. */
const LEADING_FILLERS = [
  /^(?:hey|hi|hello|yo|salut|bonjour|coucou)\b[\s,]*/iu,
  /^(?:please|pls|plz|stp|svp)\b[\s,]*/iu,
  /^(?:s'il te (?:plait|plaît)|s'il vous (?:plait|plaît))\b[\s,]*/iu,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?/iu,
  /^(?:i(?:'d| would)\s+like\s+you\s+to|i\s+want\s+you\s+to|i\s+need\s+you\s+to)\s+/iu,
  /^(?:j'aimerais\s+que\s+tu|je\s+voudrais\s+que\s+tu|peux[- ]tu|pourrais[- ]tu|tu\s+peux)\s+/iu,
  /^(?:let'?s|on\s+va)\s+/iu,
  /^(?:ok|okay|alors|bon|donc|so|now)\b[\s,]*/iu,
]

/** Markdown noise that would otherwise land inside the title. */
const LEADING_MARKUP = /^(?:[-*+>#]+|\d+[.)])\s*/u

export function heuristicTitle(prompt: string): string | null {
  // First prose line: fenced code is pasted context, never the request itself.
  let inFence = false
  let firstLine: string | undefined
  for (const raw of prompt.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || line === '') continue
    firstLine = line
    break
  }
  if (firstLine == null) return null

  let text = firstLine.replaceAll('`', '').replace(LEADING_MARKUP, '').trim()
  // Fillers stack ("hey, could you please …"), so keep peeling until stable.
  let stripped = true
  while (stripped) {
    stripped = false
    for (const filler of LEADING_FILLERS) {
      const next = text.replace(filler, '')
      if (next !== text) {
        text = next.trim()
        stripped = true
      }
    }
  }

  // Only the opening clause describes the task; the rest is detail.
  const clause = text.split(/(?<=[.!?;:])\s|\s+(?:and|then|puis|et)\s+/iu)[0] ?? text
  const title = clampTitle(clause)
  if (title == null) return null
  return title.charAt(0).toLocaleUpperCase() + title.slice(1)
}
