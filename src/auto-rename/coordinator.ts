import type { AssistantId } from '../state/types'

import { isSupportedProvider } from '../auto-commit/headless-commands'
import { heuristicTitle } from './heuristic-title'
import { PromptCapture } from './prompt-capture'
import { classifyPrompt } from './prompt-gate'
import { generateTabTitle, type TitleSpawnFn } from './title-runner'

export interface AutoRenameConfigSnapshot {
  enabled: boolean
  timeoutMs: number
  models: Partial<Record<string, string>>
  settleMs?: number
  maxAttempts?: number
  minPromptWords?: number
}

export interface AutoRenameTab {
  id: string
  assistant: AssistantId
  title: string
  autoRenameStatus?: 'eligible' | 'attempted'
}

export interface AutoRenameCoordinatorOptions {
  config: AutoRenameConfigSnapshot
  getTab: (tabId: string) => AutoRenameTab | undefined
  updateTab: (
    tabId: string,
    patch: { title?: string; autoRenameStatus?: 'eligible' | 'attempted' }
  ) => void
  spawn?: TitleSpawnFn
}

const DEFAULT_SETTLE_MS = 2_500
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_MIN_PROMPT_WORDS = 3
/** Opening prompts folded into one title request. */
const MAX_PENDING_PROMPTS = 3
/** Headless CLIs running at once, so opening a burst of tabs does not fork one per tab. */
const MAX_CONCURRENT_GENERATIONS = 2

interface TabRenameState {
  capture: PromptCapture
  /** Title-worthy prompts collected for the next generation, oldest first. */
  prompts: string[]
  /** First title-worthy prompt seen, kept as the source for the local fallback. */
  firstPrompt: string | null
  attempts: number
  settleTimer: ReturnType<typeof setTimeout> | null
  controller: AbortController | null
  /**
   * True once a provider hook delivered a real prompt. Hook payloads are ground
   * truth — dialog keystrokes never reach them — so keystroke reconstruction is
   * ignored from then on.
   */
  hookDriven: boolean
}

function normalize(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim().toLowerCase()
}

export function initialAutoRenameStatus(
  config: AutoRenameConfigSnapshot,
  assistant: AssistantId,
  candidate: boolean
): 'eligible' | undefined {
  return config.enabled && candidate && isSupportedProvider(assistant) ? 'eligible' : undefined
}

/**
 * Owns the "name this tab after what it is doing" behaviour.
 *
 * Two properties drive the design:
 *
 * - A tab only leaves `eligible` on success, on an exhausted attempt budget, or
 *   on a manual rename. Anything transient — an unreadable keystroke stream, a
 *   failed CLI, a timeout — leaves the tab armed for the next prompt, so a tab
 *   never gets stuck on its assistant label because of one bad submission.
 * - Nothing is titled from a prompt that carries no intent, and a prompt that
 *   does starts a settle window rather than an immediate request, so a rapid
 *   multi-message opening produces one title from the whole opening.
 */
export class AutoRenameCoordinator {
  private readonly states = new Map<string, TabRenameState>()
  private running = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly options: AutoRenameCoordinatorOptions) {}

  register(tab: AutoRenameTab): void {
    if (tab.autoRenameStatus === 'eligible' && !this.states.has(tab.id)) {
      this.states.set(tab.id, createState())
    }
  }

  unregister(tabId: string): void {
    const state = this.states.get(tabId)
    if (!state) return
    state.controller?.abort()
    if (state.settleTimer) clearTimeout(state.settleTimer)
    this.states.delete(tabId)
  }

  manualRename(tabId: string): void {
    this.unregister(tabId)
  }

  /** Keystroke fallback: reconstruct submissions from the bytes written to the PTY. */
  observeWrite(tabId: string, input: string): void {
    const tab = this.eligibleTab(tabId)
    if (!tab) return
    const state = this.ensureState(tabId)
    if (state.hookDriven) return

    const result = state.capture.feed(input)
    if (result.type === 'pending') return
    // A submission we could not reconstruct faithfully is dropped, not counted:
    // history recall, Tab completion and unknown escapes must not cost the tab
    // its only chance at a name.
    if (result.prompt === null) return
    this.acceptPrompt(tabId, state, result.prompt)
  }

  /**
   * Ground truth from a provider hook (Claude's `UserPromptSubmit`): the exact
   * prompt text, delivered only for real submissions.
   */
  observePrompt(tabId: string, prompt: string): void {
    const tab = this.eligibleTab(tabId)
    if (!tab) return
    const state = this.ensureState(tabId)
    if (!state.hookDriven) {
      state.hookDriven = true
      state.capture.reset()
    }
    this.acceptPrompt(tabId, state, prompt)
  }

  private eligibleTab(tabId: string): AutoRenameTab | undefined {
    const tab = this.options.getTab(tabId)
    return tab?.autoRenameStatus === 'eligible' ? tab : undefined
  }

  private ensureState(tabId: string): TabRenameState {
    const existing = this.states.get(tabId)
    if (existing) return existing
    const created = createState()
    this.states.set(tabId, created)
    return created
  }

  private acceptPrompt(tabId: string, state: TabRenameState, prompt: string): void {
    const minWords = this.options.config.minPromptWords ?? DEFAULT_MIN_PROMPT_WORDS
    if (classifyPrompt(prompt, minWords) === 'skip') return

    state.firstPrompt ??= prompt
    appendPrompt(state, prompt)
    // A generation already in flight covers this prompt's window; a settled
    // title is never rewritten.
    if (state.controller) return
    this.scheduleGeneration(tabId, state)
  }

  private scheduleGeneration(tabId: string, state: TabRenameState): void {
    if (state.settleTimer) clearTimeout(state.settleTimer)
    const settleMs = this.options.config.settleMs ?? DEFAULT_SETTLE_MS
    const timer = setTimeout(() => {
      state.settleTimer = null
      void this.generate(tabId, state)
    }, settleMs)
    // Never hold the process open for a pending title.
    timer.unref?.()
    state.settleTimer = timer
  }

  private async generate(tabId: string, state: TabRenameState): Promise<void> {
    const tab = this.eligibleTab(tabId)
    if (!tab || this.states.get(tabId) !== state || state.prompts.length === 0) return

    const controller = new AbortController()
    state.controller = controller
    state.attempts++

    const release = await this.acquireSlot()
    let result: Awaited<ReturnType<typeof generateTabTitle>>
    try {
      // The tab may have been closed or renamed while queued behind another
      // generation; drop out before spending a process on it.
      if (this.states.get(tabId) !== state || controller.signal.aborted) return
      result = await generateTabTitle({
        firstPrompt: state.prompts.join('\n\n'),
        model: this.options.config.models[tab.assistant],
        provider: tab.assistant,
        signal: controller.signal,
        spawn: this.options.spawn,
        timeoutMs: this.options.config.timeoutMs,
      })
    } finally {
      release()
    }

    if (this.states.get(tabId) !== state) return
    state.controller = null

    if (result.status === 'ok') {
      this.finish(tabId, result.title)
      return
    }

    const maxAttempts = this.options.config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    // `unavailable` means no retry can ever succeed; otherwise keep the tab
    // armed so the next prompt tries again with more context.
    if (result.status === 'failed' && state.attempts < maxAttempts) return

    this.finish(tabId, heuristicTitle(state.firstPrompt ?? state.prompts[0] ?? ''))
  }

  /** Apply the final outcome and stop watching the tab. */
  private finish(tabId: string, title: string | null): void {
    this.unregister(tabId)
    this.options.updateTab(tabId, {
      autoRenameStatus: 'attempted',
      ...(title != null && title !== '' ? { title } : {}),
    })
  }

  private async acquireSlot(): Promise<() => void> {
    if (this.running >= MAX_CONCURRENT_GENERATIONS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    this.running++
    let released = false
    return () => {
      if (released) return
      released = true
      this.running--
      this.waiting.shift()?.()
    }
  }
}

function createState(): TabRenameState {
  return {
    attempts: 0,
    capture: new PromptCapture(),
    controller: null,
    firstPrompt: null,
    hookDriven: false,
    prompts: [],
    settleTimer: null,
  }
}

/**
 * Add a prompt, keeping the pending set free of restatements of the same text.
 * The keystroke and hook paths can both report one submission, and a user often
 * rephrases; either way the title request should see the content once.
 */
function appendPrompt(state: TabRenameState, prompt: string): void {
  const incoming = normalize(prompt)
  if (incoming === '') return
  // Already covered by a pending prompt (the same submission seen through both
  // the keystroke and hook paths, or a restatement of it).
  if (state.prompts.some((existing) => normalize(existing).includes(incoming))) return
  // Supersede the shorter pending prompts this one subsumes.
  state.prompts = state.prompts.filter((existing) => !incoming.includes(normalize(existing)))
  if (state.prompts.length >= MAX_PENDING_PROMPTS) return
  state.prompts.push(prompt)
}
