/**
 * The program the pane runs: follows the journal and prints one readable line
 * per event. Not `tail -f` because a JSON object is not a line a person reads
 * over an agent's shoulder.
 *
 * Polls the file's size rather than watching it: `fs.watch` is inconsistent
 * across platforms for a file that is appended to, and half a second is fine
 * for a log.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'

const argument = process.argv[2]
if (argument === undefined) {
  process.stderr.write('usage: bun tail.ts <journal.ndjson>\n')
  process.exit(2)
}
const path: string = argument
const out = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const KEEP = 40
const POLL_MS = 500

interface Line {
  type?: string
  event?: string
  at?: string
  payload?: Record<string, unknown>
}

function clock(at: string | undefined): string {
  const date = at === undefined ? new Date() : new Date(at)
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toTimeString().slice(0, 8)
}

/** The one field of the payload worth a glance, per event family. */
function gist(event: string, payload: Record<string, unknown>): string {
  const pick = (...keys: string[]): string =>
    keys
      .filter((key) => payload[key] !== undefined && payload[key] !== null)
      .map((key) => `${key}=${String(payload[key])}`)
      .join(' ')
  if (event.startsWith('tab:')) return pick('tabId', 'status', 'activity', 'title', 'idleMs')
  if (event.startsWith('workspace:')) return pick('workspaceId', 'name', 'branch')
  if (event.startsWith('project:')) return pick('projectId', 'name', 'status')
  return pick(...Object.keys(payload).slice(0, 3))
}

function render(raw: string): string | null {
  let line: Line
  try {
    line = JSON.parse(raw) as Line
  } catch {
    return null
  }
  if (line.type === 'subscribed') return `${clock(undefined)}  · following`
  if (typeof line.event !== 'string') return null
  return `${clock(line.at)}  ${line.event.padEnd(20)} ${gist(line.event, line.payload ?? {})}`
}

let offset = 0
let carry = ''

function drain(): void {
  if (!existsSync(path)) return
  const size = statSync(path).size
  if (size < offset) {
    // Truncated or replaced: start over rather than read garbage from the middle.
    offset = 0
    carry = ''
  }
  if (size === offset) return
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    offset = size
    const text = carry + buffer.toString('utf8')
    const parts = text.split('\n')
    carry = parts.pop() ?? ''
    for (const part of parts) {
      const shown = render(part)
      if (shown !== null) out(shown)
    }
  } finally {
    closeSync(fd)
  }
}

// Start from the tail, not the top: the file is a day long and the pane is
// forty rows. Everything after is live.
if (existsSync(path)) {
  const lines = (await Bun.file(path).text()).split('\n').filter((line) => line !== '')
  for (const line of lines.slice(-KEEP)) {
    const shown = render(line)
    if (shown !== null) out(shown)
  }
  offset = statSync(path).size
} else {
  out(`waiting for ${path}`)
}

setInterval(drain, POLL_MS)
