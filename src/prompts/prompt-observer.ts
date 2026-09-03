import { PromptCapture } from '../auto-rename/prompt-capture'

/**
 * What the user asked an agent, for anyone who wants to know.
 *
 * This used to live inside `AutoRenameCoordinator`, which reconstructed
 * submissions from keystrokes only for tabs whose `autoRenameStatus` was still
 * `eligible` — i.e. tabs it had not yet named. That is the right rule for
 * auto-rename and the wrong one for everybody else: an event emitted from in
 * there would fire for a tab's first few prompts and then go silent forever,
 * which is worse than no event at all, because nothing about it says so.
 *
 * So observation moved out. It watches every tab, and auto-rename became one
 * subscriber among others — its eligibility rule now sits where it belongs,
 * next to the decision it guards.
 *
 * Two sources, and the better one wins permanently:
 *
 * - **A provider hook** (Claude's `UserPromptSubmit`) is ground truth: the
 *   exact text, only for real submissions.
 * - **Keystrokes written to the PTY**, reconstructed. This is the fallback for
 *   assistants with no hook, and it is honest about its limits — history
 *   recall, tab completion and unknown escapes mark a submission unreliable,
 *   and an unreliable one is dropped rather than reported wrong.
 *
 * Once a hook has spoken for a tab, its keystrokes are ignored: the same
 * submission would otherwise arrive twice, once right and once approximately.
 */

export type PromptSource = 'hook' | 'keystrokes'

export interface PromptObserverOptions {
  /** Called once per submission the observer is confident about. */
  onPrompt: (tabId: string, prompt: string, source: PromptSource) => void
}

interface TabPromptState {
  capture: PromptCapture
  hookDriven: boolean
}

export class PromptObserver {
  private readonly states = new Map<string, TabPromptState>()

  constructor(private readonly options: PromptObserverOptions) {}

  /** Bytes on their way to the PTY. */
  observeWrite(tabId: string, input: string): void {
    const state = this.ensure(tabId)
    if (state.hookDriven) return

    const result = state.capture.feed(input)
    if (result.type === 'pending') return
    // A submission we could not reconstruct faithfully is dropped, not
    // reported: a wrong prompt is worse for every subscriber than a missing
    // one.
    if (result.prompt === null) return
    this.options.onPrompt(tabId, result.prompt, 'keystrokes')
  }

  /** The exact prompt, from a provider hook. */
  observePrompt(tabId: string, prompt: string): void {
    const state = this.ensure(tabId)
    if (!state.hookDriven) {
      state.hookDriven = true
      // Whatever the keystroke reconstruction had half-built belongs to the
      // submission the hook just reported.
      state.capture.reset()
    }
    this.options.onPrompt(tabId, prompt, 'hook')
  }

  /** A closed tab keeps nothing. */
  forget(tabId: string): void {
    this.states.delete(tabId)
  }

  private ensure(tabId: string): TabPromptState {
    const existing = this.states.get(tabId)
    if (existing) return existing
    const created: TabPromptState = { capture: new PromptCapture(), hookDriven: false }
    this.states.set(tabId, created)
    return created
  }
}
