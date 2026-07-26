import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { buildPromptPayload, writePromptPayload } from './prompt-io'

/** Default ceiling for the submit→working transition under --await-submit. */
const DEFAULT_AWAIT_TIMEOUT_MS = 15_000

export const tabSend: CliCommand = {
  args: [
    { complete: { kind: 'dynamic', source: 'tab' }, name: 'tabId', required: true },
    { complete: { kind: 'none' }, name: 'text' },
  ],
  flags: [
    ...SHARED_FLAGS,
    { description: 'append \\r so the receiving CLI submits', kind: 'boolean', name: 'enter' },
    {
      description: 'interpret <text> as a vim-style key chord (e.g. <C-c>, <Esc>, <Up><Up>)',
      kind: 'boolean',
      name: 'keys',
    },
    {
      description: 'read the payload from stdin instead of <text>',
      kind: 'boolean',
      name: 'stdin',
    },
    {
      complete: { kind: 'file' },
      description: 'read the payload from this file instead of <text>',
      kind: 'string',
      name: 'prompt-file',
    },
    {
      description:
        'after submitting, block until the tab transitions to working (uptake confirmed)',
      kind: 'boolean',
      name: 'await-submit',
    },
    {
      description:
        'milliseconds to wait for the working transition with --await-submit (default 15000)',
      kind: 'number',
      name: 'await-timeout',
    },
  ],
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }

    const fromStdin = ctx.args.flags.stdin === true
    const promptFile =
      typeof ctx.args.flags['prompt-file'] === 'string' ? ctx.args.flags['prompt-file'] : undefined
    const asKeys = ctx.args.flags.keys === true
    const appendEnter = ctx.args.flags.enter === true
    const awaitSubmit = ctx.args.flags['await-submit'] === true
    const awaitTimeoutMs =
      typeof ctx.args.flags['await-timeout'] === 'number'
        ? ctx.args.flags['await-timeout']
        : DEFAULT_AWAIT_TIMEOUT_MS

    // Uptake only means something once something submits: either the appended
    // `\r` (--enter) or a chord that carries its own submit (--keys "<CR>",
    // which is the recovery path for a prompt already sitting in a composer).
    // Without one of those there is nothing to confirm, so fail loudly rather
    // than block forever on a transition that can't come.
    if (awaitSubmit && !appendEnter && !asKeys) {
      throw new Error('--await-submit requires --enter or --keys (the chord carries the submit)')
    }

    // At most one payload source. Unlike `tab run`, zero sources is valid here
    // (`tab send <tab> --enter` submits an empty line), so we only reject
    // conflicting combinations rather than requiring exactly one.
    if (promptFile !== undefined) {
      if (fromStdin) throw new Error('--prompt-file cannot be combined with --stdin')
      if (asKeys)
        throw new Error('--prompt-file cannot be combined with --keys (chords go in <text>)')
      if (ctx.args.positionals[1] !== undefined) {
        throw new Error('--prompt-file cannot be combined with a <text> positional')
      }
    }

    let text: string
    if (promptFile !== undefined) {
      text = await Bun.file(promptFile).text()
    } else if (fromStdin) {
      text = await Bun.stdin.text()
    } else {
      text = ctx.args.positionals[1] ?? ''
    }
    if (asKeys && text === '') {
      throw new Error('--keys requires the chord notation as <text>')
    }
    const payload = buildPromptPayload(text, asKeys)

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }

    await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })

    if (!awaitSubmit) {
      const bytesWritten = await writePromptPayload(daemon, tabId, payload, appendEnter)
      writeJson({ bytesWritten, ok: true })
      return EXIT_OK
    }

    // The daemon only emits tabStatus on TRANSITIONS, so we must be subscribed
    // before the submit write lands — otherwise the working transition can fire
    // between the write and our subscription and be lost forever. Arm the
    // listener + a one-shot promise here, then start the clock right before the
    // Enter so `ms` reflects submit→uptake latency, not setup overhead.
    const uptake = new Promise<{ confirmed: true; ms: number } | { confirmed: false }>(
      (resolve) => {
        const off = daemon.on('tabStatus', (event) => {
          if (event.tabId !== tabId || event.status !== 'working') return
          off()
          clearTimeout(timer)
          resolve({ confirmed: true, ms: Date.now() - start })
        })
        const timer = setTimeout(() => {
          off()
          resolve({ confirmed: false })
        }, awaitTimeoutMs)
      }
    )

    const start = Date.now()
    const bytesWritten = await writePromptPayload(daemon, tabId, payload, appendEnter)
    const result = await uptake

    // The bytes WERE written regardless of uptake — the working transition is
    // advisory, so a missed transition is still EXIT_OK.
    writeJson({ bytesWritten, ok: true, submitted: true, uptake: result })
    return EXIT_OK
  },
  summary: 'Write text or a key chord to a tab',
  verb: 'send',
}
