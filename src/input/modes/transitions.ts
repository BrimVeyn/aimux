import type { BuiltinModeId, ModeId } from '@brimveyn/aimux-config'

/**
 * Which built-in mode may hand over to which. Exhaustive over `BuiltinModeId`
 * on purpose: adding a mode without saying where it can go should not compile.
 *
 * Plugin modes are not in this table and cannot be — the set is not known at
 * build time. They are governed by `pluginModeTransitions` below.
 */
const TRANSITIONS: Record<BuiltinModeId, readonly ModeId[]> = {
  'git-mode': ['navigation', 'modal.git-commit', 'modal.workspace-move'],
  'modal.create-project': ['navigation', 'modal.project-picker.filtering'],
  'modal.create-workspace': ['navigation', 'terminal-input'],
  'modal.flash-jump': ['navigation'],
  'modal.git-commit': ['git-mode', 'modal.git-commit.confirm', 'modal.git-commit.generating'],
  'modal.git-commit.confirm': ['modal.git-commit', 'git-mode'],
  'modal.git-commit.generating': ['modal.git-commit', 'modal.git-commit.confirm', 'git-mode'],
  'modal.help.filtering': ['navigation'],
  'modal.new-tab.command-edit': ['navigation', 'modal.new-tab.editing-command'],
  'modal.new-tab.editing-command': ['navigation', 'modal.new-tab.command-edit'],
  'modal.project-name': ['modal.project-picker.filtering', 'navigation'],
  'modal.project-picker.filtering': ['navigation', 'modal.project-name', 'modal.create-project'],
  'modal.quotas': ['navigation', 'terminal-input'],
  'modal.rename-tab': ['navigation'],
  'modal.rename-workspace': ['navigation'],
  'modal.setting-text': ['settings'],
  'modal.settings-search.filtering': ['settings'],
  'modal.snippet-editor': ['navigation', 'modal.snippet-picker.filtering'],
  // Both pickers are reachable from the settings screen as well as from the
  // panes, and `returnTo` sends each one back where it came from.
  'modal.snippet-picker.filtering': ['navigation', 'settings', 'modal.snippet-editor'],
  'modal.split-picker': ['navigation', 'terminal-input'],
  'modal.theme-picker.filtering': ['navigation', 'settings'],
  'modal.update-available': ['navigation'],
  'modal.workspace-delete-confirm': ['navigation'],
  'modal.workspace-move': ['git-mode', 'navigation'],
  'modal.workspace-move-confirm': ['navigation'],
  'navigation': [
    'terminal-input',
    'modal.create-workspace',
    'modal.new-tab.command-edit',
    'modal.new-tab.editing-command',
    'modal.project-picker.filtering',
    'modal.help.filtering',
    'modal.snippet-picker.filtering',
    'modal.theme-picker.filtering',
    'modal.rename-tab',
    'modal.rename-workspace',
    'modal.update-available',
    'modal.quotas',
    'modal.workspace-delete-confirm',
    'modal.workspace-move-confirm',
    'modal.flash-jump',
    'git-mode',
    'settings',
    'stats',
  ],
  // The help overlay opens over settings without a transition (it leaves
  // focusMode alone). The two pickers an action row hands over to are dispatched
  // directly rather than through a KeyResult, but they are listed because that is
  // what this table is for: saying where a mode can go.
  'settings': [
    'navigation',
    'modal.setting-text',
    'modal.settings-search.filtering',
    'modal.theme-picker.filtering',
    'modal.snippet-picker.filtering',
  ],
  // Read-only screen: the only way out is back to the panes. The help overlay
  // opens on top of it without a transition, the same way it does over settings.
  'stats': ['navigation'],
  'terminal-input': ['navigation', 'modal.split-picker', 'modal.quotas', 'settings', 'stats'],
}

/**
 * What a plugin declares when it registers a mode. Both directions default to
 * `navigation` alone, which is the conservative reading: a plugin mode is
 * reachable from the panes and returns to them, and anything wider has to be
 * asked for.
 */
export interface PluginModeTransitions {
  /** Built-in or plugin modes that may enter this one. */
  from?: readonly ModeId[]
  /** Modes this one may hand over to. */
  to?: readonly ModeId[]
}

const pluginModes = new Map<string, PluginModeTransitions>()

export function isPluginModeId(id: ModeId): boolean {
  return id.startsWith('plugin.')
}

/**
 * Registers a plugin mode's transition rules. Returns the disposer the
 * plugin's fiber holds; unloading the plugin therefore also makes its mode
 * unreachable, rather than leaving a mode nothing can handle.
 */
export function registerPluginMode(
  id: ModeId,
  transitions: PluginModeTransitions = {}
): () => void {
  pluginModes.set(id, transitions)
  return () => {
    pluginModes.delete(id)
  }
}

/** Test seam. Never called by the app. */
export function clearPluginModes(): void {
  pluginModes.clear()
}

export function registeredPluginModes(): ModeId[] {
  return [...pluginModes.keys()] as ModeId[]
}

/**
 * A plugin mode that was never registered — its plugin failed to load, or was
 * unloaded while its mode was current — is not a valid destination. Falling
 * back to "allowed" would strand input in a mode with no handler.
 */
export function isValidTransition(from: ModeId, to: ModeId): boolean {
  if (isPluginModeId(from)) {
    const rules = pluginModes.get(from)
    if (!rules) return to === 'navigation'
    return to === 'navigation' || (rules.to?.includes(to) ?? false)
  }

  if (isPluginModeId(to)) {
    const rules = pluginModes.get(to)
    if (!rules) return false
    return from === 'navigation' || (rules.from?.includes(from) ?? false)
  }

  // Both ends are built-in by here: `isPluginModeId` ruled out the other case.
  return TRANSITIONS[from as BuiltinModeId].includes(to)
}
