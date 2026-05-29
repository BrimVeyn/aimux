import { open } from "@tauri-apps/plugin-dialog";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { GitPanel } from "@/components/git/GitPanel";
import { ModalHost } from "@/components/ModalHost";
import { SessionBar } from "@/components/SessionBar";
import { Sidebar } from "@/components/Sidebar";
import { SplitLayout } from "@/components/SplitLayout";
import { TerminalPane } from "@/components/TerminalPane";
import { normalizeKey } from "@/lib/keys";
import { theme } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";
import type {
  AppStateProjection,
  LayoutNode,
  ProjectedTab,
  TerminalModeState,
  TerminalSnapshot,
} from "@/lib/types";
import { type ConnectionStatus, GuiSocket } from "@/lib/ws";

interface RenderState {
  viewport: TerminalSnapshot;
  modes: TerminalModeState;
}

function App() {
  const [projection, setProjection] = useState<AppStateProjection | null>(null);
  const [renders, setRenders] = useState<Record<string, RenderState>>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socketRef = useRef<GuiSocket | null>(null);

  useTheme(projection?.themeId, projection?.themeMode);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    const socket = new GuiSocket((message) => {
      switch (message.t) {
        case "state":
          setProjection(message.projection);
          break;
        case "render":
          setRenders((prev) => ({
            ...prev,
            [message.tabId]: { modes: message.modes, viewport: message.viewport },
          }));
          break;
        case "exit":
        case "error":
        case "toast":
          break;
        default:
          break;
      }
    }, setStatus);
    socket.connect();
    socketRef.current = socket;
    return () => socket.dispose();
  }, []);

  // Window-level keyboard: every key flows to the host, which runs aimux's
  // keymap/mode pipeline (and forwards unbound keys to the PTY in terminal-input).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = normalizeKey(e);
      if (key === null) {
        return;
      }
      e.preventDefault();
      socketRef.current?.send({ t: "key", ...key });
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (text !== "") {
        e.preventDefault();
        socketRef.current?.send({ t: "paste", text });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  const activateTab = useCallback((tabId: string) => {
    socketRef.current?.send({ t: "paneActivate", tabId });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    socketRef.current?.send({ t: "closeTab", tabId });
  }, []);

  const newTab = useCallback(() => {
    socketRef.current?.send({ t: "openNewTab" });
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    socketRef.current?.send({ sessionId, t: "switchSession" });
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    socketRef.current?.send({ sessionId, t: "deleteSession" });
  }, []);

  const selectModal = useCallback((index: number) => {
    socketRef.current?.send({ index, t: "modalSelect" });
  }, []);

  const confirmModal = useCallback((index: number) => {
    socketRef.current?.send({ index, t: "modalConfirm" });
  }, []);

  const newSession = useCallback(() => {
    void (async () => {
      let path: string | null = null;
      try {
        const picked = await open({ directory: true, multiple: false });
        path = typeof picked === "string" ? picked : null;
      } catch {
        path = window.prompt("Folder path for new session:");
      }
      if (path !== null && path !== "") {
        socketRef.current?.send({ path, t: "createSession" });
      }
    })();
  }, []);

  const onScroll = useCallback((deltaLines: number) => {
    socketRef.current?.send({ deltaLines, t: "scroll" });
  }, []);

  const resizeTab = useCallback((tabId: string, cols: number, rows: number) => {
    socketRef.current?.send({ cols, rows, t: "resizeTab", tabId });
  }, []);

  const setSplitRatio = useCallback(
    (tabId: string, ratio: number, axis: "horizontal" | "vertical") => {
      socketRef.current?.send({ axis, ratio, t: "setSplitRatio", tabId });
    },
    [],
  );

  const activeTabId = projection?.activeTabId ?? null;
  const currentSession = projection?.sessions.find((s) => s.id === projection.currentSessionId);
  const activeWorktree = currentSession?.worktrees?.find(
    (w) => w.id === currentSession.activeWorktreeId,
  );
  const sidebarBranch = activeWorktree?.branch ?? null;

  const toggleWorktreeMoveDelete = useCallback(() => {
    socketRef.current?.send({ t: "toggleWorktreeMoveDelete" });
  }, []);
  const tabsById: Record<string, ProjectedTab> = {};
  for (const t of projection?.tabs ?? []) {
    tabsById[t.id] = t;
  }
  const groupId = activeTabId !== null ? (projection?.tabGroupMap[activeTabId] ?? null) : null;
  const activeTree: LayoutNode | null =
    groupId !== null ? (projection?.layoutTrees[groupId] ?? null) : null;

  const gitPane = projection?.gitPane;
  // Stage 2a: pane+top/bottom isn't a real TUI combo (top/bottom are embedded-only).
  // Fall back to left-pane behavior so the panel is still visible if the host ever
  // emits this combo; Task 3 may revisit.
  const showPanelLeftOrRight =
    gitPane?.visible === true &&
    gitPane.mode === "pane" &&
    (gitPane.position === "left" ||
      gitPane.position === "right" ||
      gitPane.position === "top" ||
      gitPane.position === "bottom");
  const showPanelEmbedded =
    gitPane?.visible === true &&
    gitPane.mode === "embedded" &&
    (gitPane.position === "top" || gitPane.position === "bottom");
  const panelOnRight = gitPane?.mode === "pane" && gitPane.position === "right";

  const gitPanelElement =
    projection !== null && gitPane !== undefined ? (
      <div
        className="h-full overflow-hidden border-r"
        style={{
          backgroundColor: theme.backgroundPanel,
          borderColor: theme.border,
          padding: 8,
        }}
      >
        <GitPanel
          gitMode={projection.gitMode}
          gitPane={gitPane}
          gitPanel={projection.gitPanel}
          projectPath={currentSession?.projectPath}
        />
      </div>
    ) : null;

  const paneWrapperStyle: React.CSSProperties =
    gitPane !== undefined
      ? { flexBasis: `${gitPane.paneRatio * 100}%`, flexShrink: 0, minWidth: 0 }
      : {};

  return (
    <div className="flex h-screen w-screen flex-col" style={{ backgroundColor: theme.background }}>
      <SessionBar
        sessions={projection?.sessions ?? []}
        statuses={projection?.sessionStatuses ?? {}}
        currentSessionId={projection?.currentSessionId ?? null}
        onSwitch={switchSession}
        onNew={newSession}
        onDelete={deleteSession}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessionName={currentSession?.name ?? null}
          branch={sidebarBranch}
          tabs={projection?.tabs ?? []}
          activeTabId={activeTabId}
          onSelectTab={activateTab}
          onCloseTab={closeTab}
          onNewTab={newTab}
          embeddedRatio={showPanelEmbedded ? gitPane?.embeddedRatio : undefined}
          gitPanelPosition={
            showPanelEmbedded ? (gitPane?.position as "top" | "bottom") : undefined
          }
          gitPanelSlot={showPanelEmbedded ? gitPanelElement : undefined}
        />
        {showPanelLeftOrRight && !panelOnRight ? (
          <div style={paneWrapperStyle}>{gitPanelElement}</div>
        ) : null}
        <main className="min-w-0 flex-1 p-1">
          {activeTree !== null && activeTree.type === "split" ? (
            <SplitLayout
              node={activeTree}
              activeTabId={activeTabId}
              tabsById={tabsById}
              renders={renders}
              onResizeTab={resizeTab}
              onActivate={activateTab}
              onScroll={onScroll}
              onSetSplitRatio={setSplitRatio}
            />
          ) : activeTabId !== null ? (
            <TerminalPane
              tabId={activeTabId}
              tab={tabsById[activeTabId]}
              snapshot={renders[activeTabId]?.viewport ?? null}
              isActive
              onResizeTab={resizeTab}
              onActivate={activateTab}
              onScroll={onScroll}
            />
          ) : null}
        </main>
        {showPanelLeftOrRight && panelOnRight ? (
          <div style={paneWrapperStyle}>{gitPanelElement}</div>
        ) : null}
        <span className="absolute right-2 bottom-1 text-xs" style={{ color: theme.textMuted }}>
          {status === "open" ? (projection?.focusMode ?? "") : status}
        </span>
      </div>
      {projection ? (
        <ModalHost
          modal={projection.modal}
          customCommands={projection.customCommands}
          worktrees={currentSession?.worktrees ?? []}
          worktreeDivergence={projection.worktreeDivergence}
          sessions={projection.sessions}
          currentSessionId={projection.currentSessionId}
          snippets={projection.snippets}
          committedThemeId={projection.committedThemeId}
          helpEntries={projection.helpEntries}
          directoryResults={projection.modal.directoryResults ?? []}
          onSelect={selectModal}
          onConfirm={confirmModal}
          onToggleDeleteSource={toggleWorktreeMoveDelete}
        />
      ) : null}
    </div>
  );
}

export default App;
