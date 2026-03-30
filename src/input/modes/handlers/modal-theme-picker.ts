import type { KeyInput, KeyResult, ModeContext, ModeHandler } from "../types";

export const modalThemePickerMode: ModeHandler = {
  id: "modal.theme-picker",

  handleKey(key: KeyInput, _ctx: ModeContext): KeyResult | null {
    if (key.name === "escape") {
      return {
        actions: [{ type: "close-modal" }],
        effects: [{ type: "apply-theme", themeId: "__restore__" }],
        transition: "navigation",
      };
    }

    if (key.name === "j" || key.name === "down") {
      return {
        actions: [{ type: "move-modal-selection", delta: 1 }],
        effects: [{ type: "apply-theme", themeId: "__preview_next__" }],
      };
    }

    if (key.name === "k" || key.name === "up") {
      return {
        actions: [{ type: "move-modal-selection", delta: -1 }],
        effects: [{ type: "apply-theme", themeId: "__preview_prev__" }],
      };
    }

    if (key.name === "return") {
      return {
        actions: [{ type: "close-modal" }],
        effects: [{ type: "apply-theme", themeId: "__confirm__" }],
        transition: "navigation",
      };
    }

    return null;
  },
};
