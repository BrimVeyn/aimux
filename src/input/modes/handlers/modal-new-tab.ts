import type { KeyInput, KeyResult, ModeContext, ModeHandler } from "../types";

export const modalNewTabMode: ModeHandler = {
  id: "modal.new-tab",

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "close-modal" }],
        effects: [],
        transition: "navigation",
      };
    }

    if (key.name === "j" || key.name === "down") {
      return { actions: [{ type: "move-modal-selection", delta: 1 }], effects: [] };
    }

    if (key.name === "k" || key.name === "up") {
      return { actions: [{ type: "move-modal-selection", delta: -1 }], effects: [] };
    }

    if (key.name === "return") {
      return {
        actions: [],
        effects: [{ type: "launch-selected-assistant" }],
      };
    }

    if (key.name === "e") {
      return {
        actions: [{ type: "begin-command-edit" }],
        effects: [],
        transition: "modal.new-tab.command-edit",
      };
    }

    return null;
  },
};
