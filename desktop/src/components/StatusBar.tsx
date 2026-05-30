import { AIUsageIndicator } from "@/components/AIUsageIndicator";
import { theme } from "@/lib/theme";
import type { AppStateProjection, FocusMode } from "@/lib/types";

// Browser-side reproduction of the TUI status bar, refined for the GUI:
// row 1 = mode pill + left content; row 2 = quiet meta (right hint + help +
// usage + version). The left/right/help strings come precomputed from the
// host (statusBar projection); the mode pill's label and color are derived
// locally from focusMode.

function modeColor(focusMode: FocusMode): string {
  switch (focusMode) {
    case "terminal-input":
      return theme.primary;
    case "modal":
    case "command-edit":
      return theme.warning;
    case "git":
      return theme.success;
    default:
      return theme.text;
  }
}

function modeLabel(focusMode: FocusMode): string {
  switch (focusMode) {
    case "terminal-input":
      return "input";
    case "modal":
      return "modal";
    case "command-edit":
      return "edit";
    case "git":
      return "git";
    default:
      return "nav";
  }
}

export function StatusBar({
  projection,
  connecting,
  onOpenUsage,
}: {
  projection: AppStateProjection;
  connecting: boolean;
  onOpenUsage: () => void;
}) {
  const { statusBar, aiUsage, focusMode } = projection;
  const color = modeColor(focusMode);
  const label = connecting ? "…" : modeLabel(focusMode);

  return (
    <div
      className="relative z-[60] flex shrink-0 flex-col gap-1 overflow-hidden border-t px-3 py-1.5"
      style={{
        backgroundColor: theme.backgroundPanel,
        borderColor: theme.border,
      }}
    >
      <div className="flex flex-row items-center gap-2 whitespace-pre">
        <span
          className="chrome-meta inline-flex h-5 items-center rounded-full px-2 uppercase tracking-wide transition-[background-color,color] duration-200 ease-out"
          style={{
            backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
            color,
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
        <span
          className="chrome-label truncate"
          style={{ color: theme.text }}
        >
          {statusBar.left}
        </span>
      </div>
      <div className="flex flex-row items-center justify-between whitespace-pre">
        <span
          className="chrome-meta truncate"
          style={{ color: theme.textMuted }}
        >
          {statusBar.right}
        </span>
        <div className="flex flex-row items-center gap-3">
          {statusBar.help !== "" ? (
            <span
              className="chrome-meta"
              style={{ color: theme.textMuted }}
            >
              {statusBar.help}
            </span>
          ) : null}
          <span className="font-mono">
            <AIUsageIndicator aiUsage={aiUsage} onOpen={onOpenUsage} />
          </span>
          <span
            className="chrome-code"
            style={{ color: theme.textMuted, opacity: 0.7 }}
          >
            v{statusBar.version}
          </span>
        </div>
      </div>
    </div>
  );
}
