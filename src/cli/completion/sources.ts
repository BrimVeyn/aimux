/**
 * Dynamic completion sources — the half of completion that needs live state.
 *
 * Two hard rules, because this code runs on every TAB press:
 *  1. Never block. Anything that could hang (a daemon round-trip) must be
 *     wrapped in a deadline by its resolver.
 *  2. Never fail loudly. A source that throws yields zero candidates; the
 *     shell must never see a stack trace where a completion list belongs.
 *
 * Phase 1 implements only the sources that read local state (built-in
 * assistants, the workspace catalog). Daemon-backed sources — tabs, workers,
 * worktrees — and git refs return nothing until phase 2 wires them up.
 */

import type { DynamicCompletionSource } from '../flags'
import type { CompletionCandidate } from './plan'

import { ASSISTANT_OPTIONS } from '../../pty/command-registry'

function assistantCandidates(): CompletionCandidate[] {
  return ASSISTANT_OPTIONS.map((option) => ({
    description: option.description,
    value: option.id,
  }))
}

async function workspaceCandidates(): Promise<CompletionCandidate[]> {
  // Imported lazily: the session catalog pulls in config + state modules that
  // the static-source paths (groups, verbs, flags) have no reason to load.
  const { listWorkspaces } = await import('../client/workspace-resolver')
  const sessions = listWorkspaces()
  const nameCounts = new Map<string, number>()
  for (const session of sessions) {
    nameCounts.set(session.name, (nameCounts.get(session.name) ?? 0) + 1)
  }
  return sessions.map((session) =>
    // Ambiguous names can't be resolved by `--workspace`, so offer the id.
    (nameCounts.get(session.name) ?? 0) > 1
      ? { description: session.name, value: session.id }
      : { description: session.id, value: session.name }
  )
}

async function resolveSource(source: DynamicCompletionSource): Promise<CompletionCandidate[]> {
  switch (source) {
    case 'assistant':
      return assistantCandidates()
    case 'workspace':
      return await workspaceCandidates()
    // Phase 2: 'tab' | 'worker' | 'worktree' need a daemon round-trip under a
    // deadline; 'git-ref' needs a `git for-each-ref` in the workspace repo.
    default:
      return []
  }
}

/**
 * Resolve a dynamic source, filter by the partial word, and re-apply the
 * prefix the planner stripped (e.g. `--workspace=`). Always resolves.
 */
export async function resolveDynamicCandidates(
  source: DynamicCompletionSource,
  word: string,
  prefix: string
): Promise<CompletionCandidate[]> {
  try {
    const candidates = await resolveSource(source)
    return candidates
      .filter((candidate) => candidate.value.startsWith(word))
      .map((candidate) => ({ ...candidate, value: `${prefix}${candidate.value}` }))
  } catch {
    return []
  }
}
