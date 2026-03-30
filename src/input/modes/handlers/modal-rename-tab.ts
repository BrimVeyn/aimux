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

export const modalRenameTabMode: ModeHandler = {
  id: "modal.rename-tab",

  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "close-modal" }],
        effects: [],
        transition: "navigation",
      };
    }

    if (key.name === "return") {
      const trimmed = (ctx.state.modal.editBuffer ?? "").trim();
      const tabId = ctx.state.modal.sessionTargetId;
      const actions: KeyResult["actions"] = [];
      if (trimmed && tabId) {
        actions.push({ type: "rename-tab", tabId, title: trimmed });
      }
      actions.push({ type: "close-modal" });
      return { actions, effects: [], transition: "navigation" };
    }

    return handleTextInput(key);
  },
};
