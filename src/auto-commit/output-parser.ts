export interface ParsedSuggestion {
  title: string
  body: string
}

const TITLE_RE = /^[ \t]*TITLE:[ \t]*(.*?)[ \t]*$/m
const BODY_MARKER_RE = /^[ \t]*BODY:[ \t]*$/m

export function parseSuggestion(raw: string): ParsedSuggestion | null {
  const titleMatch = TITLE_RE.exec(raw)
  if (!titleMatch) return null
  const title = (titleMatch[1] ?? '').trim()
  if (!title) return null

  const bodyMarker = BODY_MARKER_RE.exec(raw)
  if (!bodyMarker) return { body: '', title }
  const bodyStart = bodyMarker.index + bodyMarker[0].length
  const body = raw.slice(bodyStart).trim()

  return { body, title }
}
