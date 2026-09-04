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
 * assistants, the project catalog, plugins). Daemon-backed sources — tabs,
 * workers, workspaces — and git refs return nothing until phase 2 wires them
 * up.
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

async function projectCandidates(): Promise<CompletionCandidate[]> {
  // Imported lazily: the project catalog pulls in config + state modules that
  // the static-source paths (groups, verbs, flags) have no reason to load.
  const { listProjects } = await import('../client/project-resolver')
  const projects = listProjects()
  const nameCounts = new Map<string, number>()
  for (const project of projects) {
    nameCounts.set(project.name, (nameCounts.get(project.name) ?? 0) + 1)
  }
  return projects.map((project) =>
    // Ambiguous names can't be resolved by `--project`, so offer the id.
    (nameCounts.get(project.name) ?? 0) > 1
      ? { description: project.name, value: project.id }
      : { description: project.id, value: project.name }
  )
}

/**
 * Every plugin aimux knows: the shipped ones, plus whatever the registry
 * holds. Read from the manifests and the registry file rather than from
 * discovery — TAB must not read a plugin's directory, let alone import one.
 */
async function pluginCandidates(): Promise<CompletionCandidate[]> {
  const [{ builtinPlugins }, { loadPluginRegistryResult }] = await Promise.all([
    import('../../builtin-plugins'),
    import('../../plugins/registry-file'),
  ])
  const candidates = new Map<string, CompletionCandidate>()
  for (const builtin of builtinPlugins()) {
    candidates.set(builtin.manifest.id, {
      description: builtin.manifest.name ?? 'built-in',
      value: builtin.manifest.id,
    })
  }
  const { registry } = loadPluginRegistryResult()
  for (const entry of registry.plugins) {
    candidates.set(entry.id, { description: entry.source, value: entry.id })
  }
  for (const id of Object.keys(registry.overrides)) {
    if (!candidates.has(id)) candidates.set(id, { value: id })
  }
  return [...candidates.values()]
}

/**
 * The config keys one plugin declares. Needs the id, which is why the plan
 * carries the positionals typed so far — `plugin set <id> <TAB>` is the only
 * completion in the CLI whose answer depends on another argument.
 */
async function pluginConfigKeyCandidates(
  positionals: readonly string[]
): Promise<CompletionCandidate[]> {
  const pluginId = positionals.at(-1)
  if (pluginId === undefined || pluginId === '') return []
  const { manifestForPluginId } = await import('./plugin-manifests')
  const manifest = await manifestForPluginId(pluginId)
  return Object.entries(manifest?.config ?? {}).map(([key, field]) => ({
    description: field.label ?? field.type,
    value: key,
  }))
}

async function pluginKeymapIdCandidates(
  positionals: readonly string[]
): Promise<CompletionCandidate[]> {
  const pluginId = positionals.at(-1)
  if (pluginId === undefined || pluginId === '') return []
  const { manifestForPluginId } = await import('./plugin-manifests')
  const manifest = await manifestForPluginId(pluginId)
  return (manifest?.contributes?.keymaps ?? []).map((binding) => ({
    description: binding.description ?? binding.action,
    value: binding.id ?? binding.action,
  }))
}

async function resolveSource(
  source: DynamicCompletionSource,
  positionals: readonly string[]
): Promise<CompletionCandidate[]> {
  switch (source) {
    case 'assistant':
      return assistantCandidates()
    case 'plugin':
      return await pluginCandidates()
    case 'plugin-config-key':
      return await pluginConfigKeyCandidates(positionals)
    case 'plugin-keymap-id':
      return await pluginKeymapIdCandidates(positionals)
    case 'project':
      return await projectCandidates()
    // Phase 2: 'tab' | 'worker' | 'workspace' need a daemon round-trip under a
    // deadline; 'git-ref' needs a `git for-each-ref` in the project repo.
    default:
      return []
  }
}

/**
 * Resolve a dynamic source, filter by the partial word, and re-apply the
 * prefix the planner stripped (e.g. `--project=`). Always resolves.
 */
export async function resolveDynamicCandidates(
  source: DynamicCompletionSource,
  word: string,
  prefix: string,
  positionals: readonly string[] = []
): Promise<CompletionCandidate[]> {
  try {
    const candidates = await resolveSource(source, positionals)
    return candidates
      .filter((candidate) => candidate.value.startsWith(word))
      .map((candidate) => ({ ...candidate, value: `${prefix}${candidate.value}` }))
  } catch {
    return []
  }
}
