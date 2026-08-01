/**
 * JSON-pure stdio for CLI commands. Every command writes one JSON object to
 * stdout (or an NDJSON stream for `wait`/`tail`) and one human-readable line
 * to stderr on failure. No ANSI, no prose interleaved with JSON — agents
 * consume stdout, humans read stderr.
 */

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

export function writeNdjson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

export function writeError(message: string): void {
  process.stderr.write(`aimux: ${message}\n`)
}

// Exit code contract (docs/reference/cli.md):
//   0   success
//   2   usage error (bad flags, unknown command, missing argument)
//   3   runtime error (server replied with `error`, command failed)
//   4   daemon unreachable (socket missing and autostart failed)
//   10  question (`tab run`: worker is blocked on a question/permission)
//   11  pending submit (`worker run --detach`: prompt is in the composer but no
//       turn started — recoverable with `worker submit`, unlike a real error)
//   124 timeout (`tab wait`, `tab tail --timeout`, `project switch --wait`)
export const EXIT_OK = 0
export const EXIT_USAGE = 2
export const EXIT_RUNTIME = 3
export const EXIT_DAEMON_UNREACHABLE = 4
export const EXIT_QUESTION = 10
export const EXIT_PENDING_SUBMIT = 11
export const EXIT_TIMEOUT = 124
