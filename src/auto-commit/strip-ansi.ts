// Matches the common subset of terminal escape sequences we care about:
// - CSI sequences (ESC [ ... letter)       — SGR colors, cursor moves
// - OSC sequences (ESC ] ... BEL | ESC \\)  — title/hyperlink setters
// - Single-char ESC + letter/digit          — simple mode toggles
// - Other C0/C1 controls outside tab/newline — stripped
// Reference: https://en.wikipedia.org/wiki/ANSI_escape_code
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:\]([\s\S]*?)(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])|[\x00-\x08\x0B-\x1F\x7F]/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, '')
}
