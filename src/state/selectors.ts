import type { SessionRecord, SnippetRecord } from './types'

export function filterSessions(sessions: SessionRecord[], filter: string | null): SessionRecord[] {
  if (!filter) {
    return sessions
  }

  const lower = filter.toLowerCase()
  return sessions.filter(
    (session) =>
      session.name.toLowerCase().includes(lower) ||
      (session.projectPath && session.projectPath.toLowerCase().includes(lower))
  )
}

export function filterSnippets(snippets: SnippetRecord[], filter: string | null): SnippetRecord[] {
  if (!filter) {
    return snippets
  }

  const lower = filter.toLowerCase()
  return snippets.filter(
    (snippet) =>
      snippet.name.toLowerCase().includes(lower) || snippet.content.toLowerCase().includes(lower)
  )
}
