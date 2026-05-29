import type { ReactNode } from "react";

import { theme } from "@/lib/theme";
import type { DiffDataLite } from "@/lib/types";

import { ImageDiff } from "./ImageDiff";
import { PierreDiff } from "./PierreDiff";

interface DiffStageProps {
  diff: DiffDataLite | undefined;
  diffView: "split" | "stacked";
  loading: boolean;
  parsedFile: unknown;
  selectedKey: string | null;
  themeId: string;
}

function placeholderText(diff: DiffDataLite): string | null {
  if (diff.status === "binary") {
    const before = diff.binarySizeBefore ?? 0;
    const after = diff.binarySizeAfter ?? 0;
    return `(binary file — ${before} → ${after} bytes)`;
  }
  if (diff.rawDiff.length === 0) {
    if (diff.status === "new") return "(new file — no diff)";
    if (diff.status === "deleted") return "(deleted — no diff)";
    return "(no changes)";
  }
  return null;
}

function MutedMessage({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      className="flex h-full w-full items-center justify-center p-4 font-mono text-xs"
      style={{ color: theme.textMuted }}
    >
      {children}
    </div>
  );
}

export function DiffStage({
  diff,
  diffView,
  loading,
  parsedFile,
  selectedKey,
  themeId,
}: DiffStageProps): ReactNode {
  if (selectedKey === null || selectedKey === "") {
    return <MutedMessage>Select a file.</MutedMessage>;
  }
  if (loading && diff === undefined) {
    return <MutedMessage>Loading diff…</MutedMessage>;
  }
  if (diff === undefined) {
    return <MutedMessage>Select a file.</MutedMessage>;
  }
  if (diff.errorMessage !== undefined && diff.errorMessage !== "") {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-4 font-mono text-xs"
        style={{ color: theme.error }}
      >
        {diff.errorMessage}
      </div>
    );
  }
  if (diff.status === "image") {
    return <ImageDiff diff={diff} />;
  }
  const placeholder = placeholderText(diff);
  if (placeholder !== null) {
    return <MutedMessage>{placeholder}</MutedMessage>;
  }
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {diff.oldPath !== undefined && diff.oldPath !== "" ? (
        <div className="px-3 py-0.5 font-mono text-xs" style={{ color: theme.textMuted }}>
          renamed: {diff.oldPath} → {diff.path}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <PierreDiff diff={diff} diffView={diffView} parsedFile={parsedFile} themeId={themeId} />
      </div>
    </div>
  );
}
