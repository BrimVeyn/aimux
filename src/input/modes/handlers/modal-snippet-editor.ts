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

export const modalSnippetEditorMode: ModeHandler = {
  id: "modal.snippet-editor",

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "open-snippet-picker" }],
        effects: [],
        transition: "modal.snippet-picker",
      };
    }

    if (key.name === "tab") {
      return { actions: [{ type: "switch-create-session-field" }], effects: [] };
    }

    if (key.name === "return") {
      return {
        actions: [{ type: "close-modal" }],
        effects: [{ type: "save-snippet-editor" }],
        transition: "navigation",
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
