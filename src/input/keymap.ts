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
  | { type: "begin-command-edit" }
  | { type: "command-edit-input"; char: string }
  | { type: "commit-command-edit" }
  | { type: "cancel-command-edit" };

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

    if (key.name === "e") {
      return { type: "begin-command-edit" };
    }

    return null;
  }

  if (focusMode === "command-edit") {
    if (key.name === "escape") {
      return { type: "cancel-command-edit" };
    }

    if (key.name === "return") {
      return { type: "commit-command-edit" };
    }

    if (key.name === "backspace") {
      return { type: "command-edit-input", char: "\b" };
    }

    if (key.name === "space") {
      return { type: "command-edit-input", char: " " };
    }

    if (key.name.length === 1) {
      return {
        type: "command-edit-input",
        char: key.shift ? key.name.toUpperCase() : key.name,
      };
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

  return null;
}
