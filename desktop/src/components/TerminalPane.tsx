import { XtermPane } from "@/components/XtermPane";
import { theme } from "@/lib/theme";
import type { FocusMode, ProjectedTab } from "@/lib/types";

interface TerminalPaneProps {
  bytesEmitter: EventTarget;
  focusMode: FocusMode;
  isActive: boolean;
  onActivate: (tabId: string) => void;
  onRequestBytes: (tabId: string) => void;
  onResizeTab: (tabId: string, cols: number, rows: number) => void;
  tab: ProjectedTab | undefined;
  tabId: string;
  themeId: string;
}

// One split pane: title bar + bordered xterm.js terminal. Input stays
// host-driven (window-level keymap in App.tsx); clicking the pane sends
// paneActivate. Sizing and scrolling are owned by xterm + FitAddon.
export function TerminalPane({
  bytesEmitter,
  focusMode,
  isActive,
  onActivate,
  onRequestBytes,
  onResizeTab,
  tab,
  tabId,
  themeId,
}: TerminalPaneProps) {
  // TUI parity (src/ui/components/layout/terminal-pane.tsx getBorderColor):
  // inactive → border; active + terminal-input → accent; active otherwise → primary.
  const borderColor = !isActive
    ? theme.border
    : focusMode === "terminal-input"
      ? theme.accent
      : theme.primary;
  const title = tab ? `${tab.title} · ${tab.status}` : tabId;

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded border"
      style={{ borderColor }}
      onMouseDown={() => onActivate(tabId)}
    >
      <div
        className="flex items-center gap-1 px-2 py-0.5 font-mono text-xs"
        style={{
          backgroundColor: theme.backgroundPanel,
          borderBottom: `1px solid ${theme.border}`,
          color: isActive ? theme.primary : theme.textMuted,
        }}
      >
        <span>{isActive ? "▸" : " "}</span>
        <span className="truncate">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* key={tabId}: when the active tab changes, mount a fresh xterm.js
            instance bound to the new tabId. The XtermPane effect captures the
            tabId in closure for its bytesEmitter listener and runs only on
            mount, so without a remount we'd keep painting bytes from the
            previous tab into the wrong terminal. */}
        <XtermPane
          key={tabId}
          bytesEmitter={bytesEmitter}
          onRequestBytes={onRequestBytes}
          onResize={onResizeTab}
          tabId={tabId}
          themeId={themeId}
        />
      </div>
    </div>
  );
}
