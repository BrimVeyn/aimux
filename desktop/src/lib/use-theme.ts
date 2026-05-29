import { useEffect } from "react";

import { TUI_THEMES, isKnownThemeId } from "@aimux-config/tui/registry";
import { resolveTuiTheme } from "@aimux-config/tui/resolve";
import { TUI_COLOR_TOKENS } from "@aimux-config/tui/tokens";

import { setShikiTheme } from "./shiki";

// Resolve the active aimux theme to CSS variables on :root. The host owns the
// themeId/mode (incl. live preview via the theme-picker keymap); this effect
// re-runs whenever the projected themeId/mode change and recolors the whole app.
export function useTheme(themeId: string | undefined, mode: "dark" | "light" | undefined): void {
  useEffect(() => {
    const id = themeId !== undefined && isKnownThemeId(themeId) ? themeId : "aimux";
    const resolved = resolveTuiTheme(TUI_THEMES[id], mode ?? "dark");
    const root = document.documentElement;
    for (const token of TUI_COLOR_TOKENS) {
      root.style.setProperty(`--aimux-${token}`, resolved[token]);
    }
    // Keep the Shiki highlighter's theme aligned with the GUI theme. The
    // highlighter reloads its theme lazily on the next tokenize call (see
    // ensureActiveShikiTheme).
    setShikiTheme(themeId, mode);
  }, [themeId, mode]);
}
