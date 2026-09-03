import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

import type { AssistantId } from '../../state/types'

import { AutoRenameCoordinator } from '../../auto-rename/coordinator'

/**
 * Naming a tab after what the user asked it to do.
 *
 * The policy is all here: when to ask, what counts as a title-worthy prompt,
 * how long to wait for more of them, which model to ask, how many times to
 * retry, and what to fall back to. aimux keeps only what a tab *is* — its
 * title, and whether anyone has named it yet.
 *
 * The two halves this needs were the last two holes in the daemon API, and
 * they are why this migration waited: `ctx.tabs.rename` (a title that reaches
 * the manager, the session and every UI) and `tab:prompt` (what the user
 * actually asked, hook or reconstructed keystrokes). Neither is auto-rename's
 * — the first is what any plugin needs to name anything, the second is what
 * any plugin needs to react to a person rather than to a process.
 */

interface Config {
  enabled: boolean
  timeoutMs: number
  settleMs?: number
  maxAttempts?: number
  minPromptWords?: number
  models: Partial<Record<string, string>>
}

function readConfig(raw: Record<string, unknown>): Config {
  const num = (key: string): number | undefined =>
    typeof raw[key] === 'number' ? raw[key] : undefined
  return {
    enabled: raw.enabled !== false,
    ...(num('maxAttempts') === undefined ? {} : { maxAttempts: num('maxAttempts') }),
    ...(num('minPromptWords') === undefined ? {} : { minPromptWords: num('minPromptWords') }),
    models: (raw.models as Partial<Record<string, string>> | undefined) ?? {},
    ...(num('settleMs') === undefined ? {} : { settleMs: num('settleMs') }),
    timeoutMs: num('timeoutMs') ?? 15_000,
  }
}

export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext
    const config = readConfig(ctx.config)
    if (!config.enabled) {
      ctx.log.info('auto-rename is off in the configuration')
      return
    }

    const coordinator = new AutoRenameCoordinator({
      config,
      getTab: (tabId) => {
        const tab = ctx.tabs.get(tabId)
        if (tab === undefined) return tab
        return {
          assistant: tab.assistant as AssistantId,
          // The coordinator's own word for "still worth naming". aimux answers
          // it as `unnamed`, because the question belongs to the tab and not
          // to this plugin: a title the user typed is off limits to every
          // namer, not just this one.
          autoRenameStatus: tab.unnamed ? 'eligible' : 'attempted',
          id: tabId,
          title: tab.title,
        }
      },
      updateTab: (tabId, patch) => {
        const title = patch.title
        if (title !== undefined && title !== '') {
          void ctx.tabs.rename(tabId, title)
          return
        }
        // Gave up without a title. Renaming the tab to what it already shows
        // is how a namer says "this is its name now" — the same call, the same
        // effect on `unnamed`, and nothing on screen moves.
        const current = ctx.tabs.get(tabId)?.title
        if (current !== undefined && current !== '') void ctx.tabs.rename(tabId, current)
      },
    })

    ctx.on<{ prompt: string; tabId: string }>('tab:prompt', ({ prompt, tabId }) => {
      coordinator.onPrompt(tabId, prompt)
    })

    // A title arrived from somewhere else — the user typed one, or another
    // plugin got there first. Stop, and abort anything in flight: a generation
    // that lands afterwards would write over what they chose. (Our own rename
    // comes back through here too, on a tab we have already stopped watching.)
    ctx.on<{ tabId: string }>('tab:renamed', ({ tabId }) => {
      coordinator.manualRename(tabId)
    })

    ctx.on<{ tabId: string }>('tab:closed', ({ tabId }) => {
      coordinator.unregister(tabId)
    })

    // Nothing registers a tab up front: `onPrompt` is the only entry point,
    // and the coordinator arms a tab the first time one arrives.
    ctx.effect(() => () => {
      coordinator.disposeAll()
    })

    ctx.log.info('auto-rename is watching prompts')
  },
})
