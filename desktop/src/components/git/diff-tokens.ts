// Shared helpers for the GUI diff viewer: tokenize a whole side of the diff
// once (v1, no per-segment lazy loading) and render the resulting Shiki tokens
// as React spans.
import { createElement, type CSSProperties, type ReactNode } from "react";
import type { ThemedToken } from "shiki";

import { ensureActiveShikiTheme, ensureShikiLang, getShikiHighlighter } from "@/lib/shiki";

// Tokenize an array of lines as one document. Shiki preserves trailing `\n`
// inside its token stream, so we re-join lines (each already terminated by
// `\n` from the diff parser) and let shiki split per-line. The returned outer
// array is aligned per-source-line.
export async function tokenizeLines(lines: string[], lang: string): Promise<ThemedToken[][]> {
  if (lines.length === 0) return [];
  const highlighter = await getShikiHighlighter();
  const [langOk, themeName] = await Promise.all([
    ensureShikiLang(highlighter, lang),
    ensureActiveShikiTheme(highlighter),
  ]);
  if (!langOk) return [];
  try {
    const result = highlighter.codeToTokens(lines.join(""), {
      // shiki bundled type strictness; we already vetted the lang via ensureShikiLang
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lang: lang as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      theme: themeName as any,
    });
    return result.tokens;
  } catch {
    return [];
  }
}

interface TokenSpansProps {
  fallback: string;
  tokens?: ThemedToken[];
}

// Render a single line as Shiki spans. If tokens are missing (lang not yet
// loaded, or empty line), fall back to plain text in the current foreground.
export function renderTokenSpans({ fallback, tokens }: TokenSpansProps): ReactNode {
  if (tokens === undefined || tokens.length === 0) {
    return fallback;
  }
  return tokens.map((tok, idx) => {
    const style: CSSProperties = {};
    if (tok.color !== undefined) style.color = tok.color;
    const fs = tok.fontStyle ?? 0;
    if ((fs & 1) !== 0) style.fontStyle = "italic";
    if ((fs & 2) !== 0) style.fontWeight = "bold";
    if ((fs & 4) !== 0) style.textDecoration = "underline";
    // Token index within a line is stable for a given source line; safe key.
    return createElement("span", { key: idx, style }, stripNewline(tok.content));
  });
}

function stripNewline(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}
