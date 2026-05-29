import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Terminal } from "@/Terminal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TabMeta, TerminalModeState, TerminalSnapshot } from "@/lib/types";
import { type ConnectionStatus, GuiSocket } from "@/lib/ws";

interface RenderState {
  viewport: TerminalSnapshot;
  modes: TerminalModeState;
}

const ACTIVITY_COLOR: Record<string, string> = {
  "waiting-input": "bg-sky-400",
  working: "bg-amber-400",
};

function App() {
  const [tabs, setTabs] = useState<TabMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
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
          break;
        case "tabs":
          setTabs(message.tabs);
          setActiveTabId(message.activeTabId);
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

  const createTerminal = useCallback(() => {
    socketRef.current?.send({ assistant: "terminal", t: "createTab" });
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

  return (
    <div className="dark flex h-screen w-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b px-2 py-1.5">
        <Tabs value={activeTabId ?? undefined} onValueChange={selectTab}>
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                <span
                  className={`size-1.5 rounded-full ${ACTIVITY_COLOR[tab.activity ?? ""] ?? "bg-transparent"}`}
                />
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button size="icon" variant="ghost" className="size-7" onClick={createTerminal}>
          <Plus className="size-4" />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {status === "open" ? "connected" : status}
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <Terminal
          snapshot={active?.viewport ?? null}
          modes={active?.modes ?? null}
          onInput={onInput}
          onResize={onResize}
          onScroll={onScroll}
        />
      </main>
    </div>
  );
}

export default App;
