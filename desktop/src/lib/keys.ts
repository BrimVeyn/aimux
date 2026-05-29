// Translate a browser KeyboardEvent into the terminal byte string a PTY expects.
// Returns null when the key is not handled (caller should let the browser keep
// its default behaviour, e.g. for Cmd-based shortcuts).

const NAMED: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  Enter: "\r",
  Tab: "\t",
  Backspace: "\x7f",
  Escape: "\x1b",
};

export function encodeKey(e: KeyboardEvent): string | null {
  // Leave Cmd/Win shortcuts to the browser/OS (copy, paste, devtools, ...).
  if (e.metaKey) {
    return null;
  }

  const named = NAMED[e.key];
  if (named !== undefined) {
    return e.altKey ? `\x1b${named}` : named;
  }

  // Ctrl+letter -> control byte (Ctrl+C = 0x03, etc.).
  if (e.ctrlKey && e.key.length === 1) {
    const code = e.key.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) {
      return String.fromCharCode(code & 0x1f);
    }
    return null;
  }

  // Printable single character.
  if (e.key.length === 1) {
    return e.altKey ? `\x1b${e.key}` : e.key;
  }

  return null;
}
