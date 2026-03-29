import type { FocusMode } from "../state/types";
import { logInputDebug } from "../debug/input-log";
import { BRACKETED_PASTE_END, BRACKETED_PASTE_START, buildPtyPastePayload } from "./paste";

const CTRL_Z_RAW = "\x1a";
const CTRL_Z_KITTY = "\x1b[122;5u";
const CTRL_B_RAW = "\x02";
const CTRL_B_KITTY = "\x1b[98;5u";
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
  getBracketedPasteModeEnabled: () => boolean;
  writeToPty: (tabId: string, data: string) => void;
  leaveTerminalInput: () => void;
  toggleSidebar: () => void;
}): (sequence: string) => boolean {
  let bracketedPasteBuffer: string | null = null;

  function flushPaste(tabId: string, payload: string): void {
    logInputDebug("raw.flushPaste", {
      tabId,
      bracketedPasteModeEnabled: deps.getBracketedPasteModeEnabled(),
      payloadLength: payload.length,
      payloadPreview: payload.slice(0, 120),
    });
    deps.writeToPty(tabId, buildPtyPastePayload(payload, deps.getBracketedPasteModeEnabled()));
  }

  function handleSequence(tabId: string, sequence: string): boolean {
    if (sequence.length === 0) {
      return true;
    }

    if (bracketedPasteBuffer !== null) {
      logInputDebug("raw.collectPasteChunk", {
        tabId,
        chunkLength: sequence.length,
        chunkPreview: sequence.slice(0, 120),
      });
      const endIndex = sequence.indexOf(BRACKETED_PASTE_END);
      if (endIndex === -1) {
        bracketedPasteBuffer += sequence;
        return true;
      }

      bracketedPasteBuffer += sequence.slice(0, endIndex);
      flushPaste(tabId, bracketedPasteBuffer);
      bracketedPasteBuffer = null;
      return handleSequence(tabId, sequence.slice(endIndex + BRACKETED_PASTE_END.length));
    }

    const startIndex = sequence.indexOf(BRACKETED_PASTE_START);
    if (startIndex !== -1) {
      logInputDebug("raw.detectBracketedPasteStart", {
        tabId,
        sequenceLength: sequence.length,
        sequencePreview: sequence.slice(0, 120),
      });
      if (!handleSequence(tabId, sequence.slice(0, startIndex))) {
        return false;
      }

      const afterStart = sequence.slice(startIndex + BRACKETED_PASTE_START.length);
      const endIndex = afterStart.indexOf(BRACKETED_PASTE_END);
      if (endIndex === -1) {
        bracketedPasteBuffer = afterStart;
        return true;
      }

      flushPaste(tabId, afterStart.slice(0, endIndex));
      return handleSequence(tabId, afterStart.slice(endIndex + BRACKETED_PASTE_END.length));
    }

    if (bracketedPasteBuffer === null && (sequence === CTRL_Z_RAW || sequence === CTRL_Z_KITTY)) {
      deps.leaveTerminalInput();
      return true;
    }

    if (bracketedPasteBuffer === null && (sequence === CTRL_B_RAW || sequence === CTRL_B_KITTY)) {
      deps.toggleSidebar();
      return true;
    }

    deps.writeToPty(tabId, normalizeControlSequence(sequence));
    return true;
  }

  return (sequence: string): boolean => {
    if (deps.getFocusMode() !== "terminal-input") {
      return false;
    }

    logInputDebug("raw.sequence", {
      activeTabId: deps.getActiveTabId(),
      sequenceLength: sequence.length,
      sequencePreview: sequence.slice(0, 120),
    });

    if (sequence === CTRL_Z_RAW || sequence === CTRL_Z_KITTY) {
      deps.leaveTerminalInput();
      return true;
    }

    if (sequence === CTRL_B_RAW || sequence === CTRL_B_KITTY) {
      deps.toggleSidebar();
      return true;
    }

    const activeTabId = deps.getActiveTabId();
    if (!activeTabId) {
      return false;
    }

    return handleSequence(activeTabId, sequence);
  };
}
