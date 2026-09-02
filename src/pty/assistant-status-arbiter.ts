// Merges assistant hook events with the visual PTY detector. Hooks are
// authoritative when fresh: they tell us exactly when a user prompt was
// submitted, when a tool started or finished, and when the agent is idle. The
// visual detector still runs every tick — its job is to catch states the
// hooks don't reliably report (permission prompts that don't fire a
// Notification, or stale "working" when the hook stream lags).
//
// Claude was the only source for a long time and its event vocabulary is
// hard-coded below. A plugin assistant declaring `hooks.mapEvent` is arbitrated
// identically: the merge rule is about freshness and about which side can see a
// permission prompt, not about whose events they are.
//
// Hooks reference: https://code.claude.com/docs/en/hooks.md

import type { TabActivity } from '../state/types'

import { getAssistantDefinition } from './assistant-registry'

/** How long a hook event keeps authority over the visual detector. */
const HOOK_AUTHORITY_WINDOW_MS = 10_000

interface HookEntry {
  state: TabActivity
  at: number
}

export interface RecordHookEventInput {
  paneId: string
  hookEventName: string
  payload: Record<string, unknown>
  receivedAt?: number
  /**
   * Which assistant's hook stream this came from — the route it arrived on.
   * Absent means Claude, which is the only source that predates routing.
   */
  source?: string
}

export class AssistantStatusArbiter {
  private readonly entries = new Map<string, HookEntry>()

  /**
   * Map a Claude hook event to a `TabActivity` and record it. Returns the
   * mapped state (or null if the event was ignored, e.g. SubagentStop on a
   * parent agent — we don't want a subagent finishing to flip the parent
   * pane to idle while the parent is still mid-turn).
   */
  recordHookEvent(input: RecordHookEventInput): TabActivity | null {
    const at = input.receivedAt ?? Date.now()
    const mapped = mapForSource(input.source, input.hookEventName, input.payload)
    if (mapped === null) return null
    this.entries.set(input.paneId, { at, state: mapped })
    return mapped
  }

  /**
   * Arbitrate between a fresh visual classification and the most recent hook
   * event for the same pane. Hook wins for `working`/`idle`. If the visual
   * detector saw a permission/yes-no prompt (`waiting-input`) we trust it
   * regardless of the hook state — some prompts don't fire `Notification`,
   * and Claude is genuinely paused on user input.
   */
  arbitrate(paneId: string, visual: TabActivity, now: number): TabActivity {
    const hook = this.entries.get(paneId)
    if (!hook || now - hook.at >= HOOK_AUTHORITY_WINDOW_MS) {
      return visual
    }
    if (visual === 'waiting-input') return 'waiting-input'
    return hook.state
  }

  forget(paneId: string): void {
    this.entries.delete(paneId)
  }

  clear(): void {
    this.entries.clear()
  }
}

/**
 * Picks the mapping for the source. An unknown source with no registered
 * assistant gets none — silently applying Claude's vocabulary to another
 * vendor's event names would map most of them to `null` and the rest wrongly.
 */
function mapForSource(
  source: string | undefined,
  hookEventName: string,
  payload: Record<string, unknown>
): TabActivity | null {
  if (source === undefined || source === 'claude') {
    return mapClaudeHookEvent(hookEventName, payload)
  }
  return getAssistantDefinition(source)?.hooks?.mapEvent(hookEventName, payload) ?? null
}

function mapClaudeHookEvent(
  hookEventName: string,
  payload: Record<string, unknown>
): TabActivity | null {
  // Anything originating inside a subagent has a non-null parent_tool_use_id.
  // Forwarding its lifecycle to the parent pane is wrong: the parent is still
  // working while the subagent runs.
  const parentToolUseId = payload.parent_tool_use_id
  if (typeof parentToolUseId === 'string' && parentToolUseId.length > 0) {
    return null
  }

  switch (hookEventName) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return 'working'
    case 'Stop':
      return 'idle'
    case 'Notification':
      // Permission requests and other Claude-initiated notifications pause
      // execution until the user acts — mirror the visual detector's term.
      return 'waiting-input'
    case 'SubagentStop':
      return null
    default:
      return null
  }
}
