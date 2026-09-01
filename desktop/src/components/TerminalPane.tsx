import { XtermPane } from "@/components/XtermPane";
import { theme } from "@/lib/theme";
import type { FocusMode, ProjectedTab } from "@/lib/types";

interface TerminalPaneProps {
  bytesEmitter: EventTarget;
  focusMode: FocusMode;
  isActive: boolean;
  onActivate: (tabId: string) => void;
  onEnterInsert: () => void;
  onRequestBytes: (tabId: string) => void;
  onResizeTab: (tabId: string, cols: number, rows: number) => void;
  showActiveIndicator?: boolean;
  tab: ProjectedTab | undefined;
  tabId: string;
  themeId: string;
}

export function TerminalPane({
  bytesEmitter,
  focusMode,
  isActive,
  onActivate,
  onEnterInsert,
  onRequestBytes,
  onResizeTab,
  showActiveIndicator = false,
  tab,
  tabId,
  themeId,
}: TerminalPaneProps) {
  void tab;
  void showActiveIndicator;

  return (
    // The pane is framed, and the frame says which one has focus and in which
    // mode — same three colours `terminal-pane.tsx` uses. It replaces the rail
    // the GUI used to draw above the status bar: two things saying the same
    // thing on two axes is one more than the TUI has.
    <div
      className="relative flex h-full w-full flex-col overflow-hidden border"
      style={{ borderColor: getBorderColor(isActive, focusMode) }}
      onMouseDown={() => {
        onActivate(tabId);
        onEnterInsert();
      }}
    >
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

function getBorderColor(isActive: boolean, focusMode: FocusMode): string {
  if (!isActive) return theme.border;
  return focusMode === "terminal-input" ? theme.accent : theme.primary;
}
