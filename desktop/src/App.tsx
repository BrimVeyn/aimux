import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

import { Terminal } from "@/Terminal";
import { ModalHost } from "@/components/ModalHost";
import { SessionBar } from "@/components/SessionBar";
import { Sidebar } from "@/components/Sidebar";
import { normalizeKey } from "@/lib/keys";
import { theme } from "@/lib/theme";
import type { AppStateProjection, TerminalModeState, TerminalSnapshot } from "@/lib/types";
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

  const onResize = useCallback((cols: number, rows: number) => {
    socketRef.current?.send({ cols, rows, t: "resizeWindow" });
  }, []);

  const onScroll = useCallback((deltaLines: number) => {
    socketRef.current?.send({ deltaLines, t: "scroll" });
  }, []);

  const activeTabId = projection?.activeTabId ?? null;
  const active = activeTabId !== null ? (renders[activeTabId] ?? null) : null;
  const currentSession = projection?.sessions.find((s) => s.id === projection.currentSessionId);

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
          tabs={projection?.tabs ?? []}
          activeTabId={activeTabId}
          onSelectTab={activateTab}
          onCloseTab={closeTab}
          onNewTab={newTab}
        />
        <main className="min-w-0 flex-1">
          <Terminal
            snapshot={active?.viewport ?? null}
            onResize={onResize}
            onScroll={onScroll}
          />
        </main>
        <span className="absolute right-2 bottom-1 text-xs" style={{ color: theme.textMuted }}>
          {status === "open" ? (projection?.focusMode ?? "") : status}
        </span>
      </div>
      {projection ? (
        <ModalHost
          modal={projection.modal}
          customCommands={projection.customCommands}
          worktrees={currentSession?.worktrees ?? []}
        />
      ) : null}
    </div>
  );
}

export default App;
