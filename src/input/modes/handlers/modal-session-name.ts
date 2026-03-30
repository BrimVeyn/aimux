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

export const modalSessionNameMode: ModeHandler = {
  id: "modal.session-name",

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "open-session-picker" }],
        effects: [],
        transition: "modal.session-picker",
      };
    }

    if (key.name === "return") {
      const trimmed = (ctx.state.modal.editBuffer ?? "").trim();
      const sessionId = ctx.state.modal.sessionTargetId;
      if (trimmed && sessionId) {
        return {
          actions: [{ type: "open-session-picker" }],
          effects: [{ type: "rename-session", sessionId, name: trimmed }],
          transition: "modal.session-picker",
        };
      }
      return {
        actions: [{ type: "open-session-picker" }],
        effects: [],
        transition: "modal.session-picker",
      };
    }

    return handleTextInput(key);
  },
};
