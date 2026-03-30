import type { KeyInput, KeyResult, ModeContext, ModeHandler } from "../types";

function handleTextInput(key: KeyInput): KeyResult | null {
  if (key.name === "backspace") {
    return { actions: [{ type: "update-command-edit", char: "\b" }], effects: [] };
  }

  if (key.name === "space") {
    return { actions: [{ type: "update-command-edit", char: " " }], effects: [] };
  }

  if (key.name.length === 1) {
    const char = key.shift ? key.name.toUpperCase() : key.name;
    return { actions: [{ type: "update-command-edit", char }], effects: [] };
  }

  return null;
}

export const modalNewTabCommandEditMode: ModeHandler = {
  id: "modal.new-tab.command-edit",

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "cancel-command-edit" }],
        effects: [],
        transition: "modal.new-tab",
      };
    }

    if (key.name === "return") {
      return {
        actions: [{ type: "commit-command-edit" }],
        effects: [{ type: "save-custom-command" }],
        transition: "modal.new-tab",
      };
    }

    if (key.ctrl && key.name === "n") {
      return { actions: [{ type: "move-modal-selection", delta: 1 }], effects: [] };
    }

    if (key.ctrl && key.name === "p") {
      return { actions: [{ type: "move-modal-selection", delta: -1 }], effects: [] };
    }

    return handleTextInput(key);
  },
};
