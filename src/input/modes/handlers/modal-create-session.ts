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

export const modalCreateSessionMode: ModeHandler = {
  id: "modal.create-session",

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "open-session-picker" }],
        effects: [],
        transition: "modal.session-picker",
      };
    }

    if (key.name === "tab") {
      return { actions: [{ type: "switch-create-session-field" }], effects: [] };
    }

    if (key.name === "return") {
      if (ctx.state.modal.activeField === "directory") {
        return { actions: [{ type: "select-directory" }], effects: [] };
      }
      const trimmed = (ctx.state.modal.editBuffer ?? "").trim();
      const projectPath = ctx.state.modal.pendingProjectPath ?? undefined;
      const sessionName = trimmed || (projectPath ? projectPath.split("/").pop()! : "");
      if (sessionName) {
        return {
          actions: [{ type: "close-modal" }],
          effects: [{ type: "create-session", name: sessionName, projectPath }],
          transition: "navigation",
        };
      }
      return {
        actions: [{ type: "close-modal" }],
        effects: [],
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
