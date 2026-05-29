import type { ReactNode } from "react";

import { theme } from "@/lib/theme";
import type { DiffDataLite } from "@/lib/types";

interface ImageDiffProps {
  diff: DiffDataLite;
}

// Map common extensions to their mime types so the data: URI is browser-friendly.
// Host-side projection sets diff.imageMime when it knows; we fall back to the
// path extension and finally to image/png.
function mimeFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "image/png";
  const ext = path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "gif":
      return "image/gif";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

interface PaneProps {
  base64: string | undefined;
  label: string;
  mime: string;
}

function Pane({ base64, label, mime }: PaneProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
      <div style={{ color: theme.text }}>{label}</div>
      {base64 !== undefined && base64 !== "" ? (
        <div
          className="flex flex-1 items-center justify-center overflow-hidden rounded"
          style={{ backgroundColor: theme.backgroundElement }}
        >
          <img
            alt={label}
            className="max-h-full max-w-full object-contain"
            src={`data:${mime};base64,${base64}`}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center" style={{ color: theme.textMuted }}>
          (absent)
        </div>
      )}
    </div>
  );
}

export function ImageDiff({ diff }: ImageDiffProps): ReactNode {
  const mime = diff.imageMime ?? mimeFromPath(diff.path);
  const before = diff.imageBytesBefore;
  const after = diff.imageBytesAfter;
  const showBoth = before !== undefined && after !== undefined;
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ backgroundColor: theme.background }}
    >
      {diff.oldPath != null && diff.oldPath !== "" ? (
        <div className="px-3 py-1" style={{ color: theme.textMuted }}>
          renamed: {diff.oldPath} → {diff.path}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-row">
        {showBoth || before !== undefined ? (
          <Pane base64={before} label="old (HEAD)" mime={mime} />
        ) : null}
        {showBoth || after !== undefined ? (
          <Pane base64={after} label="new (working)" mime={mime} />
        ) : null}
      </div>
    </div>
  );
}
