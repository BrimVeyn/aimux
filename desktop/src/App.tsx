import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

import { Terminal } from "@/Terminal";
import { SessionBar } from "@/components/SessionBar";
import { Sidebar } from "@/components/Sidebar";
import { theme } from "@/lib/theme";
import type {
  SessionMeta,
  TabMeta,
  TerminalModeState,
  TerminalSnapshot,
} from "@/lib/types";
import { type ConnectionStatus, GuiSocket } from "@/lib/ws";

interface RenderState {
  viewport: TerminalSnapshot;
  modes: TerminalModeState;
}

function App() {
  const [tabs, setTabs] = useState<TabMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [renders, setRenders] = useState<Record<string, RenderState>>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socketRef = useRef<GuiSocket | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    const socket = new GuiSocket((message) => {
      switch (message.t) {
        case "init":
          setTabs(message.tabs);
          setActiveTabId(message.activeTabId);
          setSessions(message.sessions);
          setCurrentSessionId(message.currentSessionId);
          setRenders({});
          break;
        case "tabs":
          setTabs(message.tabs);
          setActiveTabId(message.activeTabId);
          break;
        case "sessions":
          setSessions(message.sessions);
          setCurrentSessionId(message.currentSessionId);
          break;
        case "render":
          setRenders((prev) => ({
            ...prev,
            [message.tabId]: { modes: message.modes, viewport: message.viewport },
          }));
          break;
        case "tabActivity":
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === message.tabId ? { ...tab, activity: message.activity } : tab,
            ),
          );
          break;
        case "exit":
        case "error":
          break;
        default:
          break;
      }
    }, setStatus);
    socket.connect();
    socketRef.current = socket;
    return () => socket.dispose();
  }, []);

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    socketRef.current?.send({ t: "setActiveTab", tabId });
  }, []);

  const newTab = useCallback(() => {
    socketRef.current?.send({ assistant: "terminal", t: "createTab" });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    socketRef.current?.send({ t: "closeTab", tabId });
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    socketRef.current?.send({ sessionId, t: "switchSession" });
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    socketRef.current?.send({ sessionId, t: "deleteSession" });
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

  const onInput = useCallback((data: string) => {
    socketRef.current?.send({ data, t: "input" });
  }, []);

  const onResize = useCallback((cols: number, rows: number) => {
    socketRef.current?.send({ cols, rows, t: "resize" });
  }, []);

  const onScroll = useCallback((deltaLines: number) => {
    socketRef.current?.send({ deltaLines, t: "scroll" });
  }, []);

  const active = activeTabId !== null ? (renders[activeTabId] ?? null) : null;
  const sessionName = sessions.find((s) => s.id === currentSessionId)?.name ?? null;

  return (
    <div className="flex h-screen w-screen flex-col" style={{ backgroundColor: theme.background }}>
      <SessionBar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitch={switchSession}
        onNew={newSession}
        onDelete={deleteSession}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessionName={sessionName}
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onNewTab={newTab}
        />
        <main className="min-w-0 flex-1">
          <Terminal
            snapshot={active?.viewport ?? null}
            modes={active?.modes ?? null}
            onInput={onInput}
            onResize={onResize}
            onScroll={onScroll}
          />
        </main>
        <span className="absolute right-2 bottom-1 text-xs" style={{ color: theme.textMuted }}>
          {status === "open" ? "" : status}
        </span>
      </div>
    </div>
  );
}

export default App;
