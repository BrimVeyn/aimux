import {
  definePlugin,
  type PluginCommitMessage,
  type UiPluginContext,
} from '@brimveyn/aimux-plugin'

import { buildHeadlessInvocation } from '../../auto-commit/headless-commands'
import { composePromptFromTemplate, loadBriefingTemplate } from '../../auto-commit/prompt-loader'
import { runSuggestion } from '../../auto-commit/suggestion-runner'
import { isCommandAvailable } from '../../pty/command-registry'

/**
 * The words of the commit, written by asking the assistant you are already
 * working with.
 *
 * aimux keeps everything that makes auto-commit a *feature*: when to trigger,
 * the working-tree hash that says a suggestion has gone stale, the abort that
 * supersedes an in-flight generation, the panel it appears in. This plugin
 * holds the one decision inside it that has no single right answer, and it
 * holds it the same way a third-party plugin would — through
 * `ctx.ui.git.provideCommitMessage`, with no privileged path of its own.
 *
 * That is the point of migrating it rather than leaving it in the driver: the
 * slot is only trustworthy once something real depends on it, and a built-in
 * that cheated would prove nothing. It registers as a **built-in**, so any
 * plugin the user installs displaces it — otherwise aimux would have been
 * first-come-first-served on its own boot, and the slot would be a promise
 * nobody outside could ever collect on.
 */

interface Config {
  timeoutMs: number
  models: Partial<Record<string, string>>
  profileConfigRoot: string
}

function readConfig(raw: Record<string, unknown>): Config {
  return {
    models: (raw.models as Partial<Record<string, string>> | undefined) ?? {},
    profileConfigRoot: typeof raw.profileConfigRoot === 'string' ? raw.profileConfigRoot : '',
    timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : 60_000,
  }
}

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext
    const config = readConfig(ctx.config)

    // Loaded once and kept: the briefing is a file on disk that a user edits
    // between sessions, not between commits.
    let template: string | null = null
    const briefing = async (): Promise<string> => {
      template ??= await loadBriefingTemplate({ profileConfigRoot: config.profileConfigRoot })
      return template
    }

    ctx.ui.git.provideCommitMessage(
      async (request, signal): Promise<PluginCommitMessage | null> => {
        const model = config.models[request.assistant]
        const probe = buildHeadlessInvocation(request.assistant, '__probe__', model)
        if (!probe) {
          ctx.log.info(`no headless invocation for ${request.assistant}`)
          return null
        }
        if (!isCommandAvailable(probe.executable)) {
          ctx.log.info(`'${probe.executable}' is not in PATH`)
          return null
        }

        const prompt = composePromptFromTemplate(await briefing(), {
          branch: request.branch,
          diff: request.diff,
          recentCommits: request.recentCommits,
          sessionTail: request.sessionTail ?? '[no session tail available]',
        })
        const invocation = buildHeadlessInvocation(request.assistant, prompt, model)
        if (!invocation) return null

        const parsed = await runSuggestion({
          invocation,
          signal,
          timeoutMs: config.timeoutMs,
        })
        // `null` here is a model that said nothing usable, which is a decline
        // rather than a failure: aimux clears the suggestion and waits for the
        // next working-tree change.
        return parsed === null ? null : { body: parsed.body, title: parsed.title }
      }
    )

    ctx.log.info('auto-commit writes the commit messages')
  },
})
