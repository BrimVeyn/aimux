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
 * One slot, first registration wins. Two plugins both answering would mean the
 * message you get depends on load order, which is the kind of bug that costs an
 * evening; the second is refused and told why in its own log.
 */

export type CommitMessageProvider = (
  request: PluginCommitMessageRequest,
  signal: AbortSignal
) => Promise<PluginCommitMessage | null> | PluginCommitMessage | null

interface Slot {
  pluginId: string
  provide: CommitMessageProvider
}

let slot: Slot | null = null

export interface ProviderRegistration {
  /** False when someone already holds the slot; the reason says who. */
  accepted: boolean
  reason?: string
  dispose: () => void
}

export function registerCommitMessageProvider(
  pluginId: string,
  provide: CommitMessageProvider
): ProviderRegistration {
  if (slot !== null && slot.pluginId !== pluginId) {
    const reason = `${slot.pluginId} already provides commit messages`
    logDebug('git.commitProvider.refused', { held: slot.pluginId, pluginId })
    return {
      accepted: false,
      dispose: () => {
        /* nothing was taken, so nothing comes back */
      },
      reason,
    }
  }
  const entry: Slot = { pluginId, provide }
  slot = entry
  return {
    accepted: true,
    dispose: () => {
      if (slot === entry) slot = null
    },
  }
}

export function getCommitMessageProvider(): Slot | null {
  return slot
}

/** Test seam. Never called by the app. */
export function clearCommitMessageProvider(): void {
  slot = null
}
