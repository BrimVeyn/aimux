import type { KeyEvent } from "@opentui/core";

import type { FocusMode } from "../state/types";

export type AppIntent =
  | { type: "quit" }
  | { type: "open-new-tab-modal" }
  | { type: "close-tab" }
  | { type: "close-modal" }
  | { type: "confirm-modal" }
  | { type: "move-modal-selection"; delta: number }
  | { type: "move-tab"; delta: number }
  | { type: "reorder-tab"; delta: number }
  | { type: "enter-terminal-input" }
  | { type: "leave-terminal-input" }
  | { type: "toggle-sidebar" }
  | { type: "resize-sidebar"; delta: number }
  | { type: "send-to-pty"; data: string };

function ctrlLetter(letter: string): string {
  return String.fromCharCode(letter.toLowerCase().charCodeAt(0) - 96);
}

export function keyEventToPtyInput(
  key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence"> & {
    code?: string;
    baseCode?: number;
    source?: "raw" | "kitty";
  },
): string | null {
  if (key.name === "tab" || key.code === "Tab" || key.baseCode === 9) {
    return key.shift ? "\u001b[Z" : "\t";
  }

  if (key.ctrl && key.name.length === 1) {
    return ctrlLetter(key.name);
  }

  if (key.meta && key.name.length === 1) {
    return `\u001b${key.shift ? key.name.toUpperCase() : key.name}`;
  }

  switch (key.name) {
    case "return":
      return "\r";
    case "backspace":
      return "\u007f";
    case "escape":
      return "\u001b";
    case "space":
      return " ";
    case "up":
      return "\u001b[A";
    case "down":
      return "\u001b[B";
    case "right":
      return "\u001b[C";
    case "left":
      return "\u001b[D";
    case "delete":
      return "\u001b[3~";
    case "home":
      return "\u001b[H";
    case "end":
      return "\u001b[F";
    case "pageup":
      return "\u001b[5~";
    case "pagedown":
      return "\u001b[6~";
    case "f1":
      return "\u001bOP";
    case "f2":
      return "\u001bOQ";
    case "f3":
      return "\u001bOR";
    case "f4":
      return "\u001bOS";
    default:
      if (key.sequence && key.sequence.length === 1) {
        return key.sequence;
      }

      if (key.name.length === 1) {
        return key.shift ? key.name.toUpperCase() : key.name;
      }

      return null;
  }
}

export function resolveKeyIntent(
  key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence"> & {
    code?: string;
    baseCode?: number;
    source?: "raw" | "kitty";
  },
  focusMode: FocusMode,
): AppIntent | null {
  if (key.ctrl && key.name === "c" && focusMode !== "terminal-input") {
    return { type: "quit" };
  }

  if (focusMode === "modal") {
    if (key.name === "escape") {
      return { type: "close-modal" };
    }

    if (key.name === "j" || key.name === "down") {
      return { type: "move-modal-selection", delta: 1 };
    }

    if (key.name === "k" || key.name === "up") {
      return { type: "move-modal-selection", delta: -1 };
    }

    if (key.name === "return") {
      return { type: "confirm-modal" };
    }

    return null;
  }

  if (focusMode === "navigation") {
    if (key.ctrl && key.name === "n") {
      return { type: "open-new-tab-modal" };
    }

    if (key.ctrl && key.name === "w") {
      return { type: "close-tab" };
    }

    if (key.ctrl && key.name === "b") {
      return { type: "toggle-sidebar" };
    }

    if (key.ctrl && key.name === "h") {
      return { type: "resize-sidebar", delta: -2 };
    }

    if (key.ctrl && key.name === "l") {
      return { type: "resize-sidebar", delta: 2 };
    }

    if (key.shift && key.name === "j") {
      return { type: "reorder-tab", delta: 1 };
    }

    if (key.name === "j") {
      return { type: "move-tab", delta: 1 };
    }

    if (key.shift && key.name === "k") {
      return { type: "reorder-tab", delta: -1 };
    }

    if (key.name === "k") {
      return { type: "move-tab", delta: -1 };
    }

    if (key.name === "i") {
      return { type: "enter-terminal-input" };
    }

    return null;
  }

  if (focusMode === "terminal-input") {
    if (key.ctrl && key.name === "z") {
      return { type: "leave-terminal-input" };
    }

    const data = keyEventToPtyInput(key);
    return data ? { type: "send-to-pty", data } : null;
  }

  return null;
}
