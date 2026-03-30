import type { KeyInput, KeyResult, ModeContext, ModeHandler } from "../types";

export const modalHelpMode: ModeHandler = {
  id: "modal.help",

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "close-modal" }],
        effects: [],
        transition: "navigation",
      };
    }

    return null;
  },
};
