import { homedir } from 'node:os'
import { join } from 'node:path'

import { shellSplit } from '../pty/command-registry'

/**
 * What the argv of a tab says about its conversation.
 *
 * aimux hands the session id to the CLI at spawn (`--session-id`, `--resume`)
 * and the daemon keeps the whole argv as `command`, so the id is already in
 * the daemon's registry — as a string nobody parsed. This parses it. Same for
 * `--model`. Reading the argv rather than adding a field means a tab created
 * by any client, on any protocol version, answers the same way.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_FLAG = /^(?:-r|--resume|--session-id)$/
const MODEL_FLAG = /^(?:-m|--model)$/

export interface ParsedSessionArgs {
  sessionId: string | null
  model: string | null
}

export function parseSessionArgs(command: string): ParsedSessionArgs {
  const args = shellSplit(command)
  let sessionId: string | null = null
  let model: string | null = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    const next = args[i + 1]
    if (SESSION_FLAG.test(arg) && next !== undefined && UUID.test(next)) {
      sessionId = next
      i++
      continue
    }
    if (MODEL_FLAG.test(arg) && next !== undefined && !next.startsWith('-')) {
      model = next
      i++
      continue
    }
    const inline = /^--(?:session-id|resume|model)=(.+)$/.exec(arg)
    if (inline?.[1] !== undefined) {
      if (arg.startsWith('--model=')) model = inline[1]
      else if (UUID.test(inline[1])) sessionId = inline[1]
    }
  }
  return { model, sessionId }
}

/**
 * Where the vendor keeps the transcript, when it keeps one we know how to
 * find. Claude writes `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`; the slug
 * is globbed away because the uuid alone is unique. Null for everything else
 * — an honest "no transcript" beats a guessed path.
 */
export function findTranscriptPath(assistant: string, sessionId: string | null): string | null {
  if (sessionId === null || assistant !== 'claude') return null
  // `$HOME` first: it is what the vendor CLI itself honours, and what a test
  // or a sandboxed profile points elsewhere.
  const home = process.env.HOME != null && process.env.HOME !== '' ? process.env.HOME : homedir()
  const cwd = join(home, '.claude', 'projects')
  try {
    const found = new Bun.Glob(`*/${sessionId}.jsonl`).scanSync({ cwd }).next()
    return found.done === true ? null : join(cwd, found.value)
  } catch {
    return null
  }
}
