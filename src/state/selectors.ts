import type { AssistantOption } from '../pty/command-registry'
import type { SessionRecord, SnippetRecord } from './types'

export function filterAssistants(
  options: AssistantOption[],
  filter: string | null
): AssistantOption[] {
  if (!(filter != null && filter !== '')) return options
  const lower = filter.toLowerCase()
  return options.filter(
    (o) => o.label.toLowerCase().includes(lower) || o.description.toLowerCase().includes(lower)
  )
}

export function filterSessions(sessions: SessionRecord[], filter: string | null): SessionRecord[] {
  if (!(filter != null && filter !== '')) {
    return sessions
  }

  const lower = filter.toLowerCase()
  return sessions.filter(
    (session) =>
      session.name.toLowerCase().includes(lower) ||
      (session.projectPath != null &&
        session.projectPath !== '' &&
        session.projectPath.toLowerCase().includes(lower))
  )
}

export function filterSnippets(snippets: SnippetRecord[], filter: string | null): SnippetRecord[] {
  if (!(filter != null && filter !== '')) {
    return snippets
  }

  const lower = filter.toLowerCase()
  return snippets.filter(
    (snippet) =>
      snippet.name.toLowerCase().includes(lower) || snippet.content.toLowerCase().includes(lower)
  )
}
