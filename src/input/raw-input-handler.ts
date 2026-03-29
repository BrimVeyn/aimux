import type { FocusMode } from "../state/types";

const CTRL_Z_RAW = "\x1a";
const CTRL_Z_KITTY = "\x1b[122;5u";
const KITTY_CTRL_RE = /^\x1b\[(\d+);(\d+)u$/;

function normalizeControlSequence(sequence: string): string {
  const match = KITTY_CTRL_RE.exec(sequence);
  if (!match) {
    return sequence;
  }

  const codePoint = Number(match[1]);
  const modifiers = Number(match[2]) - 1;
  const hasCtrl = (modifiers & 4) !== 0;
  const hasAlt = (modifiers & 2) !== 0;

  if (!hasCtrl || hasAlt) {
    return sequence;
  }

  if ((codePoint >= 65 && codePoint <= 90) || (codePoint >= 97 && codePoint <= 122)) {
    return String.fromCharCode(codePoint & 0x1f);
  }

  switch (codePoint) {
    case 32:
    case 50:
    case 64:
      return "\x00";
    case 51:
    case 91:
      return "\x1b";
    case 52:
    case 92:
      return "\x1c";
    case 53:
    case 93:
      return "\x1d";
    case 54:
    case 94:
      return "\x1e";
    case 47:
    case 55:
    case 95:
      return "\x1f";
    case 56:
    case 63:
      return "\x7f";
    default:
      return sequence;
  }
}

export interface TerminalContentOrigin {
  /** 0-based screen column of the first content cell */
  x: number;
  /** 0-based screen row of the first content cell */
  y: number;
  /** PTY column count */
  cols: number;
  /** PTY row count */
  rows: number;
}

export function createRawInputHandler(deps: {
  getFocusMode: () => FocusMode;
  getActiveTabId: () => string | null;
  getContentOrigin: () => TerminalContentOrigin;
  getMousePassthroughEnabled: () => boolean;
  writeToPty: (tabId: string, data: string) => void;
  leaveTerminalInput: () => void;
}): (sequence: string) => boolean {
  return (sequence: string): boolean => {
    if (deps.getFocusMode() !== "terminal-input") {
      return false;
    }

    if (sequence === CTRL_Z_RAW || sequence === CTRL_Z_KITTY) {
      deps.leaveTerminalInput();
      return true;
    }

    const activeTabId = deps.getActiveTabId();
    if (!activeTabId) {
      return false;
    }

    deps.writeToPty(activeTabId, normalizeControlSequence(sequence));
    return true;
  };
}
