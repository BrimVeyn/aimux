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
  // Show a thin left-edge accent on the active pane, so split layouts can
  // disambiguate which pane has keyboard focus. Pure pane-level info: the
  // global focus mode (nav vs input) is communicated by FocusModeRail at
  // the top of <main>, on a different axis to avoid visual conflict.
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
  void focusMode;
  void tab;
  const showLeftRail = showActiveIndicator && isActive;

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      onMouseDown={() => {
        onActivate(tabId);
        onEnterInsert();
      }}
    >
      {showLeftRail ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 left-0 z-10 w-[2px] rounded-r-full"
          style={{ backgroundColor: theme.primary, opacity: 0.6 }}
        />
      ) : null}
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
