import type { PluginCommitMessage, PluginCommitMessageRequest } from '@brimveyn/aimux-plugin'

import { logDebug } from '../debug/input-log'

/**
 * Who writes the commit message.
 *
 * Git mode is not a point of extension — it is the application: a screen, a
 * diff renderer, a command queue, a PR panel. Turning it into a plugin would
 * make the plugin API aimux's internal API, which is the one thing
 * `apiVersion: 1` promises not to be. What *is* worth opening is the one
 * decision inside it that has no single right answer: the words of the commit.
 *
 * So this is a slot, not a subsystem. aimux keeps the trigger, the working-tree
 * hash, the abort and the panel; a plugin answers the question "what should
 * this commit say", from whatever it likes — a different model, a ticket
 * number, a house style, a template.
 *
 * Two ranks, because aimux ships a provider of its own:
 *
 * - **A built-in** (`aimux.auto-commit`) holds the slot when nothing else
 *   wants it. It is the reference implementation, and it is what makes the
 *   feature work out of the box.
 * - **A user's plugin displaces it.** Anything else would make the slot a
 *   promise aimux itself had already broken: first-come-first-served with a
 *   built-in registered at boot means no third-party plugin could ever win.
 *
 * Two user plugins is still a refusal — between equals, the message you get
 * would depend on load order, which is the kind of bug that costs an evening —
 * and the second is told why in its own log. When a user's plugin unloads, the
 * built-in has the slot back.
 */

export type CommitMessageProvider = (
  request: PluginCommitMessageRequest,
  signal: AbortSignal
) => Promise<PluginCommitMessage | null> | PluginCommitMessage | null

export interface CommitMessageSlot {
  pluginId: string
  provide: CommitMessageProvider
  builtin: boolean
}

/** Ordered by rank, not by arrival: user plugins first, the built-in last. */
let providers: CommitMessageSlot[] = []

export interface ProviderRegistration {
  /** False when another user plugin already holds the slot; `reason` says who. */
  accepted: boolean
  reason?: string
  dispose: () => void
}

export function registerCommitMessageProvider(
  pluginId: string,
  provide: CommitMessageProvider,
  options: { builtin?: boolean } = {}
): ProviderRegistration {
  const builtin = options.builtin === true
  const incumbent = providers.find((entry) => !entry.builtin && entry.pluginId !== pluginId)
  if (!builtin && incumbent !== undefined) {
    const reason = `${incumbent.pluginId} already provides commit messages`
    logDebug('git.commitProvider.refused', { held: incumbent.pluginId, pluginId })
    return {
      accepted: false,
      dispose: () => {
        /* nothing was taken, so nothing comes back */
      },
      reason,
    }
  }

  const entry: CommitMessageSlot = { builtin, pluginId, provide }
  providers = [...providers.filter((existing) => existing.pluginId !== pluginId), entry]
  return {
    accepted: true,
    dispose: () => {
      providers = providers.filter((existing) => existing !== entry)
    },
  }
}

/** The provider that answers: a user's plugin if there is one, else the built-in. */
export function getCommitMessageProvider(): CommitMessageSlot | null {
  return (
    providers.find((entry) => !entry.builtin) ?? providers.find((entry) => entry.builtin) ?? null
  )
}

/** Test seam. Never called by the app. */
export function clearCommitMessageProvider(): void {
  providers = []
}
