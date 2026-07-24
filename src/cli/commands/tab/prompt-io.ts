/**
 * Shared prompt-write plumbing for `tab send` and `tab run`. Both need to lower
 * a chord/paste buffer into the protocol's string form and submit it with the
 * bracketed-paste `\r` deferral, so the logic lives here once.
 */
import type { DaemonClient } from '../../client/daemon-client'

import { bracketedPaste, notationToBytes } from '../../chord'
import { CliUsageError } from '../../flags'

/**
 * Gap between the bracketed-paste write and the trailing carriage return when
 * submitting a pasted block. Claude Code (and other paste-aware TUIs) buffer
 * every byte between the paste-start/paste-end markers; a `\r` that arrives in
 * the same burst as the paste-end marker is folded into the paste buffer as
 * literal content instead of being read as a submit keystroke. A short settle
 * lets the receiver exit paste mode before the Enter lands.
 */
export const PASTE_SUBMIT_SETTLE_MS = 50

/**
 * Resolve prompt text from exactly one source — `--prompt-file`, `--stdin`, or
 * a positional `[text]`. Requiring exactly one prevents an orchestrator from
 * silently sending the wrong buffer when two are set (e.g. a stale positional
 * plus a fresh `--prompt-file`). Used by `tab run`; `tab send` keeps its own
 * looser guard (zero sources is valid there).
 */
export async function resolvePromptText(
  promptFile: string | undefined,
  fromStdin: boolean,
  positionalText: string | undefined
): Promise<string> {
  const sources = [promptFile !== undefined, fromStdin, positionalText !== undefined].filter(
    (present) => present
  ).length
  if (sources !== 1) {
    throw new CliUsageError(
      'provide exactly one prompt source: --prompt-file <f>, --stdin, or a [text] positional'
    )
  }
  if (promptFile !== undefined) return Bun.file(promptFile).text()
  if (fromStdin) return Bun.stdin.text()
  return positionalText ?? ''
}

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

export interface PromptPayload {
  /** The protocol-ready string to write. */
  data: string
  /**
   * Whether `data` is a bracketed-paste block. A trailing `\r` must be sent as
   * a separate, settled write for these — see PASTE_SUBMIT_SETTLE_MS.
   */
  bracketed: boolean
}

/**
 * Build the payload for a prompt. `asKeys` interprets the text as a vim-style
 * chord (e.g. `<C-c>`); otherwise it's wrapped as a bracketed paste when
 * multi-line.
 */
export function buildPromptPayload(text: string, asKeys: boolean): PromptPayload {
  if (asKeys) {
    return { bracketed: false, data: bytesToString(notationToBytes(text)) }
  }
  const data = bracketedPaste(text)
  return { bracketed: data !== text, data }
}

/**
 * Write a prompt payload to a tab, optionally appending a submit `\r`. The
 * payload write and the Enter are always separate `write` requests; for a
 * bracketed paste the Enter is deferred by PASTE_SUBMIT_SETTLE_MS so it isn't
 * swallowed by the paste buffer. Returns the number of bytes written.
 */
export async function writePromptPayload(
  daemon: DaemonClient,
  tabId: string,
  payload: PromptPayload,
  appendEnter: boolean
): Promise<number> {
  await daemon.expectOk('write', { data: payload.data, tabId })
  let bytesWritten = Buffer.byteLength(payload.data, 'utf8')
  if (appendEnter) {
    // A bracketed paste swallows a same-burst `\r`, so settle first, then
    // submit as an independent write. Plain text / key chords carry no paste
    // markers, so the Enter can follow immediately — but still as its own
    // write so the two paths stay uniform.
    if (payload.bracketed) {
      await Bun.sleep(PASTE_SUBMIT_SETTLE_MS)
    }
    await daemon.expectOk('write', { data: '\r', tabId })
    bytesWritten += 1
  }
  return bytesWritten
}
