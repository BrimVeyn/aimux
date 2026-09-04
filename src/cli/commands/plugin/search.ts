import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'

/**
 * The index is a GitHub topic, not a registry: a repository tagged
 * `aimux-plugin` is listed, by stars, and that is the whole convention.
 * herdr's marketplace is the same thing behind a web page; here the page is
 * `aimux plugin search`, and `install owner/repo` is one copy-paste away.
 */
export const PLUGIN_TOPIC = 'aimux-plugin'

interface SearchHit {
  spec: string
  name: string
  description: string | null
  stars: number
  url: string
  updatedAt: string | null
}

interface GitHubSearchResponse {
  total_count?: number
  items?: {
    full_name?: string
    name?: string
    description?: string | null
    stargazers_count?: number
    html_url?: string
    pushed_at?: string | null
  }[]
}

export async function searchPluginIndex(
  query: string,
  limit: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ total: number; hits: SearchHit[] }> {
  const q = `topic:${PLUGIN_TOPIC}${query === '' ? '' : ` ${query}`}`
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${limit}`
  const response = await fetchImpl(url, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'aimux' },
  })
  if (!response.ok) {
    throw new Error(
      `GitHub search failed (${response.status}): ${(await response.text()).slice(0, 200)}`
    )
  }
  const body = (await response.json()) as GitHubSearchResponse
  return {
    hits: (body.items ?? []).map((item) => ({
      description: item.description ?? null,
      name: item.name ?? '',
      spec: item.full_name ?? '',
      stars: item.stargazers_count ?? 0,
      updatedAt: item.pushed_at ?? null,
      url: item.html_url ?? '',
    })),
    total: body.total_count ?? 0,
  }
}

export const pluginSearch: CliCommand = {
  args: [{ complete: { kind: 'none' }, name: 'query' }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'How many results (default 20)', kind: 'number', name: 'limit' },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const query = ctx.args.positionals.join(' ').trim()
    const limit = typeof ctx.args.flags.limit === 'number' ? ctx.args.flags.limit : 20
    try {
      const { hits, total } = await searchPluginIndex(query, Math.max(1, Math.min(100, limit)))
      writeJson({ query, results: hits, topic: PLUGIN_TOPIC, total })
      return EXIT_OK
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeError(message)
      writeJson({ error: message, kind: 'runtime-error', query, topic: PLUGIN_TOPIC })
      return EXIT_RUNTIME
    }
  },
  summary: `Search GitHub for repositories tagged ${PLUGIN_TOPIC}`,
  verb: 'search',
}
