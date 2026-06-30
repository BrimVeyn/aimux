import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { bracketedPaste, notationToBytes } from '../../chord'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

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
    if (fromStdin) {
      const stdinText = await Bun.stdin.text()
      data = asKeys ? bytesToString(notationToBytes(stdinText)) : bracketedPaste(stdinText)
    } else {
      const text = ctx.args.positionals[1] ?? ''
      if (asKeys) {
        if (text === '') throw new Error('--keys requires the chord notation as <text>')
        data = bytesToString(notationToBytes(text))
      } else {
        data = bracketedPaste(text)
      }
    }

    if (appendEnter) {
      data = `${data}\r`
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

    writeJson({ bytesWritten: Buffer.byteLength(data, 'utf8'), ok: true })
    return EXIT_OK
  },
  summary: 'Write text or a key chord to a tab',
  verb: 'send',
}
