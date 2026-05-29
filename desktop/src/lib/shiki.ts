// Browser Shiki initializer. Port of src/ui/shiki.ts adapted for the GUI:
// instead of reading from the TUI theme-store, we resolve the current aimux
// theme via @aimux-config (same source used by useTheme) and feed it through
// tuiThemeToShiki — keeps highlight colors in sync with the rest of the GUI.

import {
  type BundledLanguage,
  createHighlighter,
  type Highlighter,
  type ThemeRegistrationRaw,
} from "shiki";

import { TUI_THEMES, isKnownThemeId } from "@aimux-config/tui/registry";
import { resolveTuiTheme } from "@aimux-config/tui/resolve";
import { tuiThemeToShiki } from "@aimux-config/tui/shiki";
import type { ThemeMode } from "@aimux-config/tui/types";

let activeThemeId: string | null = null;
let currentThemeId: string = "aimux";
let currentThemeMode: ThemeMode = "dark";
let highlighterPromise: Promise<Highlighter> | null = null;

const loadedLangs = new Set<string>();

export function setShikiTheme(themeId: string | undefined, mode: ThemeMode | undefined): void {
  currentThemeId = themeId !== undefined && isKnownThemeId(themeId) ? themeId : "aimux";
  currentThemeMode = mode ?? "dark";
}

function buildActiveTheme(): { id: string; raw: ThemeRegistrationRaw } {
  const id = `${currentThemeId}-${currentThemeMode}`;
  const resolved = resolveTuiTheme(TUI_THEMES[currentThemeId], currentThemeMode);
  return {
    id,
    raw: tuiThemeToShiki({ mode: currentThemeMode, name: id, theme: resolved }),
  };
}

export async function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const initial = buildActiveTheme();
    activeThemeId = initial.id;
    highlighterPromise = createHighlighter({ langs: [], themes: [initial.raw] });
  }
  return highlighterPromise;
}

export async function ensureShikiLang(h: Highlighter, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;
  try {
    await h.loadLanguage(lang as BundledLanguage);
    loadedLangs.add(lang);
    return true;
  } catch {
    return false;
  }
}

export async function ensureActiveShikiTheme(h: Highlighter): Promise<string> {
  const { id, raw } = buildActiveTheme();
  if (id === activeThemeId) return id;
  try {
    await h.loadTheme(raw);
    activeThemeId = id;
  } catch {
    // best-effort
  }
  return activeThemeId ?? id;
}
