import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef } from "react";

import { resolveKeyIntent } from "./input/keymap";
import { getAssistantOption, isCommandAvailable } from "./pty/command-registry";
import { PtyManager } from "./pty/pty-manager";
import { appReducer, createInitialState } from "./state/store";
import type { AssistantId, TabSession } from "./state/types";
import { RootView } from "./ui/root";

const IDLE_TIMEOUT_MS = 2_000;
const STARTUP_GRACE_MS = 5_000;

function createTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTabSession(assistant: AssistantId): TabSession {
  const index = ["claude", "codex", "opencode"].indexOf(assistant);
  const option = getAssistantOption(index);

  return {
    id: createTabId(),
    assistant,
    title: option.label,
    status: "starting",
    activity: "idle",
    buffer: "",
    command: option.command,
  };
}

export function App() {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const ptyManagerRef = useRef<PtyManager | null>(null);
  const idleTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startupGraceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  if (!ptyManagerRef.current) {
    ptyManagerRef.current = new PtyManager();
  }

  const ptyManager = ptyManagerRef.current;

  function clearIdleTimer(tabId: string) {
    const timeout = idleTimeoutsRef.current.get(tabId);
    if (timeout) {
      clearTimeout(timeout);
      idleTimeoutsRef.current.delete(tabId);
    }
  }

  function clearStartupGrace(tabId: string) {
    const timeout = startupGraceTimeoutsRef.current.get(tabId);
    if (timeout) {
      clearTimeout(timeout);
      startupGraceTimeoutsRef.current.delete(tabId);
    }
  }

  function isStartupGraceActive(tabId: string): boolean {
    return startupGraceTimeoutsRef.current.has(tabId);
  }

  function startStartupGrace(tabId: string) {
    clearStartupGrace(tabId);
    const timeout = setTimeout(() => {
      startupGraceTimeoutsRef.current.delete(tabId);
    }, STARTUP_GRACE_MS);
    startupGraceTimeoutsRef.current.set(tabId, timeout);
  }

  function scheduleIdle(tabId: string) {
    clearIdleTimer(tabId);
    const timeout = setTimeout(() => {
      dispatch({ type: "set-tab-activity", tabId, activity: "idle" });
      idleTimeoutsRef.current.delete(tabId);
    }, IDLE_TIMEOUT_MS);
    idleTimeoutsRef.current.set(tabId, timeout);
  }

  useEffect(() => {
    const handleRender = (tabId: string, viewport: TabSession["viewport"]) => {
      if (!viewport) {
        return;
      }

      dispatch({ type: "replace-tab-viewport", tabId, viewport });
      if (isStartupGraceActive(tabId)) {
        return;
      }

      dispatch({ type: "set-tab-activity", tabId, activity: "busy" });
      scheduleIdle(tabId);
    };

    const handleExit = (tabId: string, exitCode: number) => {
      clearIdleTimer(tabId);
      clearStartupGrace(tabId);

      if (exitCode === 0) {
        dispatch({ type: "close-tab", tabId });
        return;
      }

      dispatch({ type: "set-tab-status", tabId, status: "exited", exitCode });
      dispatch({ type: "set-tab-activity", tabId, activity: undefined });
      dispatch({
        type: "set-tab-error",
        tabId,
        message: `[process exited with code ${exitCode}]`,
      });
    };

    const handleError = (tabId: string, message: string) => {
      clearIdleTimer(tabId);
      clearStartupGrace(tabId);
      dispatch({ type: "set-tab-error", tabId, message });
    };

    ptyManager.on("render", handleRender);
    ptyManager.on("exit", handleExit);
    ptyManager.on("error", handleError);

    return () => {
      for (const timeout of idleTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      idleTimeoutsRef.current.clear();
      for (const timeout of startupGraceTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      startupGraceTimeoutsRef.current.clear();
      ptyManager.off("render", handleRender);
      ptyManager.off("exit", handleExit);
      ptyManager.off("error", handleError);
      ptyManager.disposeAll();
    };
  }, [ptyManager]);

  const terminalSize = useMemo(() => {
    const sidebarWidth = state.sidebar.visible ? state.sidebar.width + 3 : 0;
    const cols = Math.max(20, Math.floor(dimensions.width - sidebarWidth - 4));
    const rows = Math.max(8, Math.floor(dimensions.height - 6));
    return { cols, rows };
  }, [dimensions.height, dimensions.width, state.sidebar.visible, state.sidebar.width]);

  useEffect(() => {
    dispatch({
      type: "set-terminal-size",
      cols: terminalSize.cols,
      rows: terminalSize.rows,
    });
    ptyManager.resizeAll(terminalSize.cols, terminalSize.rows);
  }, [ptyManager, terminalSize.cols, terminalSize.rows]);

  function launchAssistant(assistant: AssistantId) {
    const tab = createTabSession(assistant);
    dispatch({ type: "add-tab", tab });
    startStartupGrace(tab.id);

    if (!isCommandAvailable(tab.command)) {
      clearStartupGrace(tab.id);
      dispatch({
        type: "set-tab-error",
        tabId: tab.id,
        message: `[command not found] ${tab.command} is not available in PATH.`,
      });
      return;
    }

    ptyManager.createSession({
      tabId: tab.id,
      command: tab.command,
      cols: state.layout.terminalCols,
      rows: state.layout.terminalRows,
    });
  }

  useKeyboard((key) => {
    const intent = resolveKeyIntent(key, state.focusMode);
    if (!intent) {
      return;
    }

    key.preventDefault();

    switch (intent.type) {
      case "quit":
        ptyManager.disposeAll();
        renderer.destroy();
        process.exit(0);
        return;
      case "open-new-tab-modal":
        dispatch({ type: "open-new-tab-modal" });
        return;
      case "close-tab":
        if (state.activeTabId) {
          clearIdleTimer(state.activeTabId);
          clearStartupGrace(state.activeTabId);
          ptyManager.disposeSession(state.activeTabId);
          dispatch({ type: "close-tab", tabId: state.activeTabId });
        }
        return;
      case "close-modal":
        dispatch({ type: "close-modal" });
        return;
      case "confirm-modal": {
        const option = getAssistantOption(state.modal.selectedIndex);
        launchAssistant(option.id);
        return;
      }
      case "move-modal-selection":
        dispatch({ type: "move-modal-selection", delta: intent.delta });
        return;
      case "move-tab":
        dispatch({ type: "move-active-tab", delta: intent.delta });
        return;
      case "reorder-tab":
        dispatch({ type: "reorder-active-tab", delta: intent.delta });
        return;
      case "enter-terminal-input":
        dispatch({ type: "set-focus-mode", focusMode: "terminal-input" });
        return;
      case "leave-terminal-input":
        dispatch({ type: "set-focus-mode", focusMode: "navigation" });
        return;
      case "toggle-sidebar":
        dispatch({ type: "toggle-sidebar" });
        return;
      case "resize-sidebar":
        dispatch({ type: "resize-sidebar", delta: intent.delta });
        return;
      case "send-to-pty":
        if (state.activeTabId) {
          ptyManager.write(state.activeTabId, intent.data);
        }
        return;
      default:
        return;
    }
  });

  return <RootView state={state} />;
}
