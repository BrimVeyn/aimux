import type { KeyPayload } from "./types";

// Normalize a browser KeyboardEvent into aimux's KeyInput shape. The host owns
// chord matching AND terminal byte-encoding, so the browser only forwards a
// normalized descriptor. Returns null for events we let the browser handle
// (pure modifier presses, Cmd/Win shortcuts).

const NAMED: Record<string, string> = {
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  Backspace: "backspace",
  Delete: "delete",
  End: "end",
  Enter: "return",
  Escape: "escape",
  Home: "home",
  Insert: "insert",
  PageDown: "pagedown",
  PageUp: "pageup",
  Tab: "tab",
  " ": "space",
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function normalizeKey(e: KeyboardEvent): KeyPayload | null {
  if (MODIFIER_KEYS.has(e.key)) {
    return null;
  }
  // Leave Cmd/Win shortcuts to the browser/OS (copy, paste, devtools).
  if (e.metaKey) {
    return null;
  }

  const named = NAMED[e.key];
  let name: string;
  if (named !== undefined) {
    name = named;
  } else if (e.key.length === 1 && /^[A-Za-z]$/.test(e.key)) {
    name = e.key.toLowerCase();
  } else {
    name = e.key;
  }

  return {
    ctrl: e.ctrlKey,
    meta: e.altKey,
    name,
    sequence: e.key.length === 1 ? e.key : "",
    shift: e.shiftKey,
  };
}
