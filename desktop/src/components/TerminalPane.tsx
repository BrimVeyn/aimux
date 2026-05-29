import { XtermPane } from "@/components/XtermPane";
import { theme } from "@/lib/theme";
import type { ProjectedTab } from "@/lib/types";

interface TerminalPaneProps {
  bytesEmitter: EventTarget;
  isActive: boolean;
  onActivate: (tabId: string) => void;
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
  isActive,
  onActivate,
  onResizeTab,
  tab,
  tabId,
  themeId,
}: TerminalPaneProps) {
  const borderColor = isActive ? theme.primary : theme.border;
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
        <XtermPane
          bytesEmitter={bytesEmitter}
          onResize={onResizeTab}
          tabId={tabId}
          themeId={themeId}
        />
      </div>
    </div>
  );
}
