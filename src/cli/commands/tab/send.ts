import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { bracketedPaste, notationToBytes } from '../../chord'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

/**
 * Gap between the bracketed-paste write and the trailing carriage return when
 * `--enter` submits a pasted block. Claude Code (and other paste-aware TUIs)
 * buffer every byte between the paste-start/paste-end markers; a `\r` that
 * arrives in the same burst as the paste-end marker is folded into the paste
 * buffer as literal content instead of being read as a submit keystroke. A
 * short settle lets the receiver exit paste mode before the Enter lands.
 */
const PASTE_SUBMIT_SETTLE_MS = 50

/**
 * Lower a chord/paste buffer of bytes into the string the protocol expects.
 * Every byte we emit is < 0x80 (control chars or printable ASCII), so a
 * Latin-1 decode is faithful — the receiving PTY's UTF-8 path treats each
 * single byte as itself.
 */
function bytesToString(bytes: Buffer): string {
  let out = ''
  for (const byte of bytes) {
    out += String.fromCharCode(byte)
  }
  return out
}

export const tabSend: CliCommand = {
  args: [{ name: 'tabId', required: true }, { name: 'text' }],
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
  ],
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }

    const fromStdin = ctx.args.flags.stdin === true
    const asKeys = ctx.args.flags.keys === true
    const appendEnter = ctx.args.flags.enter === true

    let data: string
    // Whether `data` is a bracketed-paste block (multi-line text that
    // `bracketedPaste` wrapped in start/end markers). A trailing `\r` must be
    // sent as a *separate*, settled write for these — see PASTE_SUBMIT_SETTLE_MS.
    let bracketed = false
    if (fromStdin) {
      const stdinText = await Bun.stdin.text()
      if (asKeys) {
        data = bytesToString(notationToBytes(stdinText))
      } else {
        data = bracketedPaste(stdinText)
        bracketed = data !== stdinText
      }
    } else {
      const text = ctx.args.positionals[1] ?? ''
      if (asKeys) {
        if (text === '') throw new Error('--keys requires the chord notation as <text>')
        data = bytesToString(notationToBytes(text))
      } else {
        data = bracketedPaste(text)
        bracketed = data !== text
      }
    }

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }

    await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })
    await daemon.expectOk('write', { data, tabId })

    let bytesWritten = Buffer.byteLength(data, 'utf8')
    if (appendEnter) {
      // A bracketed paste swallows a same-burst `\r`, so settle first, then
      // submit as an independent write. Plain text / key chords carry no paste
      // markers, so the Enter can follow immediately — but still as its own
      // write so the two paths stay uniform.
      if (bracketed) {
        await Bun.sleep(PASTE_SUBMIT_SETTLE_MS)
      }
      await daemon.expectOk('write', { data: '\r', tabId })
      bytesWritten += 1
    }

    writeJson({ bytesWritten, ok: true })
    return EXIT_OK
  },
  summary: 'Write text or a key chord to a tab',
  verb: 'send',
}
