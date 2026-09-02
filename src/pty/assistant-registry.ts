import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import type { UsageSnapshot } from '../services/ai-usage/types'
import type { AssistantId, QuestionKind, TabActivity } from '../state/types'
import type { AssistantOption } from './command-registry'

/**
 * Assistants contributed by plugins.
 *
 * An assistant is not one thing. It is a spawn command, a way of reading its
 * TUI to tell working from waiting, a way of parsing the choices in a blocked
 * prompt, optionally a usage endpoint, and optionally a hook stream that
 * outranks the visual reading. aimux's five built-ins each spell all of that
 * out in a different file, keyed by a `switch` on the id.
 *
 * A plugin declares them together, in one object, because they are one thing
 * from the outside: `aimux tab create --assistant acme.robot` either works
 * completely or is a half-integration where the tab spawns and then never
 * reports a status.
 *
 * The built-ins stay where they are and are consulted first. This registry is
 * the second lookup, not a replacement — phase 4 is where a built-in moves
 * across, if it earns it.
 */

/** What the status detector hands a classifier. */
export interface AssistantClassifyInput {
  /** Lower-cased 10-line tail. Prompts land at the bottom, so this is where "is it waiting" reads. */
  haystack: string
  /** The same tail, un-lowered, for glyph and spinner matching. */
  tail: string
  /** The whole visible frame, for a status line an overlay has pushed up. */
  screen: string
}

/**
 * `null` means "no opinion" and hands over to the generic
 * quiet-screen-means-idle heuristic — the same contract the built-in
 * classifiers have.
 */
export type AssistantClassifier = (input: AssistantClassifyInput) => TabActivity | null

export interface AssistantQuestionInput {
  kind: QuestionKind
  /** The captured prompt text, trailing-trimmed. Authoritative. */
  prompt: string
  /** The prompt's lines, oldest first. */
  lines: readonly string[]
}

/**
 * Best-effort choice parsing. Returning `undefined` is normal and expected:
 * TUIs render menus in shapes that shift between versions, and `prompt` is the
 * source of truth either way.
 */
export type AssistantQuestionParser = (input: AssistantQuestionInput) => string[] | undefined

export interface AssistantHookSpec {
  /**
   * Env var carrying the hook URL into every PTY of this assistant, the way
   * `AIMUX_HOOK_URL` does for Claude. The plugin's own bridge script reads it.
   */
  urlEnvVar: string
  /**
   * Maps one received hook event to an activity, or null to ignore it. Hook
   * events outrank the visual detector while fresh; see the arbiter.
   */
  mapEvent: (hookEventName: string, payload: Record<string, unknown>) => TabActivity | null
}

export interface AssistantDefinition {
  /** Spawn command, label, model/session flag builders — the same shape the built-ins use. */
  option: AssistantOption
  detectStatus?: AssistantClassifier
  extractOptions?: AssistantQuestionParser
  /** Fills the usage indicator. Registered under `option.id` as a usage tool. */
  usage?: (config: AIUsageToolConfig) => Promise<UsageSnapshot>
  hooks?: AssistantHookSpec
}

const assistants = new Map<string, AssistantDefinition>()

/**
 * Registers an assistant. Returns the disposer the plugin's fiber holds.
 *
 * Unregistering does not close the tabs already running it: a PTY outlives the
 * plugin that described how to spawn it, and killing a live agent because its
 * plugin reloaded would be a far worse trade than a tab that briefly falls back
 * to the generic status heuristic.
 */
export function registerAssistant(definition: AssistantDefinition): () => void {
  assistants.set(definition.option.id, definition)
  return () => {
    if (assistants.get(definition.option.id) === definition) assistants.delete(definition.option.id)
  }
}

/** Test seam. Never called by the app. */
export function clearAssistants(): void {
  assistants.clear()
}

export function getAssistantDefinition(id: AssistantId): AssistantDefinition | undefined {
  return assistants.get(id)
}

export function pluginAssistantOptions(): AssistantOption[] {
  return [...assistants.values()].map((definition) => definition.option)
}
