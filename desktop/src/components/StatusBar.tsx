import { AIUsageIndicator } from "@/components/AIUsageIndicator";
import { theme } from "@/lib/theme";
import type { AppStateProjection, FocusMode } from "@/lib/types";

// Browser-side reproduction of the TUI status bar
// (src/ui/components/layout/status-bar.tsx). Two rows over a panel background:
// row 1 = [mode] badge + left content; row 2 = keybind hints (left) and the
// help hint + usage indicator + version (right). The left/right/help strings
// come precomputed from the host (statusBar projection); the mode badge's
// label and color are derived locally from focusMode.

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

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden px-2 py-0.5 font-mono text-xs"
      style={{ backgroundColor: theme.backgroundPanel }}
    >
      <div className="flex flex-row items-center whitespace-pre">
        <span style={{ color: modeColor(focusMode) }}>
          [{connecting ? "…" : modeLabel(focusMode)}]
        </span>
        <span> </span>
        <span className="truncate" style={{ color: theme.text }}>
          {statusBar.left}
        </span>
      </div>
      <div className="flex flex-row items-center justify-between whitespace-pre">
        <span className="truncate" style={{ color: theme.textMuted }}>
          {statusBar.right}
        </span>
        <div className="flex flex-row items-center gap-2">
          {statusBar.help !== "" ? (
            <span style={{ color: theme.textMuted }}>{statusBar.help}</span>
          ) : null}
          <AIUsageIndicator aiUsage={aiUsage} onOpen={onOpenUsage} />
          <span style={{ color: theme.textMuted }}>v{statusBar.version}</span>
        </div>
      </div>
    </div>
  );
}
