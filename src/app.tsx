import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef } from "react";

import { resolveKeyIntent } from "./input/keymap";
import { getAssistantOption, isCommandAvailable } from "./pty/command-registry";
import { PtyManager } from "./pty/pty-manager";
import { appReducer, createInitialState } from "./state/store";
import type { AssistantId, TabSession } from "./state/types";
import { RootView } from "./ui/root";

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
    buffer: "",
    command: option.command,
  };
}

export function App() {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const ptyManagerRef = useRef<PtyManager | null>(null);

  if (!ptyManagerRef.current) {
    ptyManagerRef.current = new PtyManager();
  }

  const ptyManager = ptyManagerRef.current;

  useEffect(() => {
    const handleRender = (tabId: string, viewport: TabSession["viewport"]) => {
      if (!viewport) {
        return;
      }

      dispatch({ type: "replace-tab-viewport", tabId, viewport });
    };

    const handleExit = (tabId: string, exitCode: number) => {
      dispatch({ type: "set-tab-status", tabId, status: "exited", exitCode });
      dispatch({
        type: "append-tab-buffer",
        tabId,
        chunk: `\n[process exited with code ${exitCode}]\n`,
      });
    };

    const handleError = (tabId: string, message: string) => {
      dispatch({ type: "set-tab-error", tabId, message });
    };

    ptyManager.on("render", handleRender);
    ptyManager.on("exit", handleExit);
    ptyManager.on("error", handleError);

    return () => {
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

    if (!isCommandAvailable(tab.command)) {
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
