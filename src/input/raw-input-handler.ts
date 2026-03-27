import type { FocusMode } from "../state/types";

const CTRL_Z_RAW = "\x1a";
const CTRL_Z_KITTY = "\x1b[122;5u";
const KITTY_CTRL_RE = /^\x1b\[(\d+);(\d+)u$/;

/** Matches SGR mouse sequences: \x1b[<button;x;yM or \x1b[<button;x;ym */
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;
const BASIC_MOUSE_PREFIX = "\x1b[M";

type MouseTrackingMode = "none" | "x10" | "vt200" | "drag" | "any";

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

function adjustMouseCoordinates(screenX: number, screenY: number, origin: TerminalContentOrigin): {
  ptyX: number;
  ptyY: number;
} | null {
  const ptyX = screenX - origin.x;
  const ptyY = screenY - origin.y;

  if (ptyX < 1 || ptyY < 1 || ptyX > origin.cols || ptyY > origin.rows) {
    return null;
  }

  return { ptyX, ptyY };
}

function adjustSgrMouseSequence(sequence: string, origin: TerminalContentOrigin): string | null {
  const match = SGR_MOUSE_RE.exec(sequence);
  if (!match) {
    return null;
  }

  const button = match[1];
  const screenX = Number(match[2]); // 1-based
  const screenY = Number(match[3]); // 1-based
  const suffix = match[4]; // M (press) or m (release)

  const adjustedCoordinates = adjustMouseCoordinates(screenX, screenY, origin);
  if (!adjustedCoordinates) {
    return null;
  }

  return `\x1b[<${button};${adjustedCoordinates.ptyX};${adjustedCoordinates.ptyY}${suffix}`;
}

function isBasicMouseSequence(sequence: string): boolean {
  return sequence.startsWith(BASIC_MOUSE_PREFIX) && sequence.length === 6;
}

function adjustBasicMouseSequence(sequence: string, origin: TerminalContentOrigin): string | null {
  if (!isBasicMouseSequence(sequence)) {
    return null;
  }

  const rawButtonCode = sequence.charCodeAt(3) - 32;
  const screenX = sequence.charCodeAt(4) - 32;
  const screenY = sequence.charCodeAt(5) - 32;
  const adjustedCoordinates = adjustMouseCoordinates(screenX, screenY, origin);
  if (!adjustedCoordinates) {
    return null;
  }

  const isScroll = (rawButtonCode & 64) !== 0;
  const isMotion = (rawButtonCode & 32) !== 0;
  const isRelease = !isScroll && !isMotion && (rawButtonCode & 3) === 3;
  const suffix = isRelease ? "m" : "M";

  return `\x1b[<${rawButtonCode};${adjustedCoordinates.ptyX};${adjustedCoordinates.ptyY}${suffix}`;
}

function adjustMouseSequence(sequence: string, origin: TerminalContentOrigin): string | null {
  return adjustSgrMouseSequence(sequence, origin) ?? adjustBasicMouseSequence(sequence, origin);
}

function isMouseSequence(sequence: string): boolean {
  return SGR_MOUSE_RE.test(sequence) || isBasicMouseSequence(sequence);
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

    const activeTabId = deps.getActiveTabId();
    if (!activeTabId) {
      return false;
    }

    const adjusted = adjustMouseSequence(sequence, deps.getContentOrigin());
    if (adjusted !== null) {
      if (!deps.getMousePassthroughEnabled()) {
        return false;
      }

      deps.writeToPty(activeTabId, adjusted);
      return true;
    }

    if (isMouseSequence(sequence)) {
      return deps.getMousePassthroughEnabled();
    }

    if (sequence === CTRL_Z_RAW || sequence === CTRL_Z_KITTY) {
      deps.leaveTerminalInput();
      return true;
    }

    deps.writeToPty(activeTabId, normalizeControlSequence(sequence));
    return true;
  };
}
