import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki";

import { buildDiffSegments } from "@aimux/ui/components/git/diff-renderer/build-rows";
import {
  type PreparedParsedDiff,
  prepareDiff,
} from "@aimux/ui/components/git/diff-renderer/prepare-diff";

import { theme } from "@/lib/theme";
import type { DiffDataLite } from "@/lib/types";

import { tokenizeLines } from "./diff-tokens";
import { SplitView } from "./SplitView";
import { StackedView } from "./StackedView";

interface PierreDiffProps {
  diff: DiffDataLite;
  diffView: "split" | "stacked";
  // PreparedParsedDiff from the store, projected as `unknown` (see types.ts);
  // we narrow with a structural cast below — same pattern the TUI uses.
  parsedFile: unknown;
  themeId: string;
}

function isParsedDiff(value: unknown): value is PreparedParsedDiff {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<PreparedParsedDiff>;
  return (
    "segments" in v &&
    Array.isArray((v as { segments?: unknown }).segments) &&
    "firstChangeOffset" in v
  );
}

export function PierreDiff({ diff, diffView, parsedFile, themeId }: PierreDiffProps): ReactNode {
  // Prefer the store's prepared file (computed by the host pipeline). If
  // missing (race / projection ordering), fall back to a local parse.
  const projected = isParsedDiff(parsedFile) ? parsedFile : null;
  const [localPrepared, setLocalPrepared] = useState<PreparedParsedDiff | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (projected !== null) {
      setLocalPrepared(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPreparing(true);
    void (async () => {
      try {
        const prepared = await prepareDiff(diff.rawDiff, diff.path, { signal: controller.signal });
        if (!cancelled) {
          setLocalPrepared(prepared.parsed);
          setPreparing(false);
        }
      } catch {
        if (!cancelled) setPreparing(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [diff.path, diff.rawDiff, projected]);

  const prepared = projected ?? localPrepared;
  const file = prepared?.file ?? null;

  // Recompute segments with no folds (v1 has no fold UI yet).
  const segments = useMemo(() => {
    if (!file) return [];
    return buildDiffSegments(file).segments;
  }, [file]);

  // v1: tokenize each side as one document. Cached implicitly by useEffect deps
  // (rawDiff + themeId + filetype). Plain text is shown while shiki resolves.
  const [addTokens, setAddTokens] = useState<ThemedToken[][]>([]);
  const [delTokens, setDelTokens] = useState<ThemedToken[][]>([]);

  const lang = prepared?.filetype ?? null;
  useEffect(() => {
    if (!file || lang === null) {
      setAddTokens([]);
      setDelTokens([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [adds, dels] = await Promise.all([
        tokenizeLines(file.additionLines, lang),
        tokenizeLines(file.deletionLines, lang),
      ]);
      if (!cancelled) {
        setAddTokens(adds);
        setDelTokens(dels);
      }
    })();
    return () => {
      cancelled = true;
    };
    // diff.rawDiff is the canonical content identity; themeId reloads colors.
  }, [diff.rawDiff, file, lang, themeId]);

  if (!file) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-4 font-mono text-xs"
        style={{ color: theme.textMuted }}
      >
        {preparing ? "Preparing diff…" : "(could not parse diff)"}
      </div>
    );
  }

  if (diffView === "stacked") {
    return (
      <StackedView addTokens={addTokens} delTokens={delTokens} file={file} segments={segments} />
    );
  }
  return <SplitView addTokens={addTokens} delTokens={delTokens} file={file} segments={segments} />;
}
