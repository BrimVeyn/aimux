import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef } from "react";

import { resolveKeyIntent } from "./input/keymap";
import { createRawInputHandler, type TerminalContentOrigin } from "./input/raw-input-handler";
import { loadConfig, saveConfig } from "./config";
import { ASSISTANT_OPTIONS, getAssistantOption, isCommandAvailable, parseCommand } from "./pty/command-registry";
import { PtyManager } from "./pty/pty-manager";
import { appReducer, createInitialState } from "./state/store";
import type { AssistantId, TabSession, TerminalModeState } from "./state/types";
import { RootView } from "./ui/root";

const IDLE_TIMEOUT_MS = 2_000;
const STARTUP_GRACE_MS = 5_000;
const MAIN_AREA_HORIZONTAL_CHROME = 4;
const MAIN_AREA_VERTICAL_PADDING = 2;
const STATUS_BAR_HEIGHT = 4;
const TERMINAL_PANE_VERTICAL_CHROME = 4;
const MIN_TERMINAL_ROWS = 1;
const MIN_TERMINAL_COLS = 20;
const DISABLE_TERMINAL_PASSTHROUGH = "\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l\x1b[?1007l";

function createTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTabSession(assistant: AssistantId, customCommand?: string): TabSession {
  const index = ["claude", "codex", "opencode"].indexOf(assistant);
  const option = getAssistantOption(index);

  return {
    id: createTabId(),
    assistant,
    title: option.label,
    status: "starting",
    activity: "idle",
    buffer: "",
    terminalModes: {
      mouseTrackingMode: "none",
      sendFocusMode: false,
      alternateScrollMode: false,
    },
    command: customCommand ?? option.command,
  };
}

function buildTerminalPassthroughEnableSequence(terminalModes: TerminalModeState): string {
  let sequence = "";

  switch (terminalModes.mouseTrackingMode) {
    case "x10":
      sequence += "\x1b[?9h";
      break;
    case "vt200":
      sequence += "\x1b[?1000h";
      break;
    case "drag":
      sequence += "\x1b[?1002h";
      break;
    case "any":
      sequence += "\x1b[?1003h";
      break;
    default:
      break;
  }

  if (terminalModes.mouseTrackingMode !== "none") {
    sequence += "\x1b[?1006h";
  }

  if (terminalModes.sendFocusMode) {
    sequence += "\x1b[?1004h";
  }

  if (terminalModes.alternateScrollMode) {
    sequence += "\x1b[?1007h";
  }

  return sequence;
}

export function App() {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const { customCommands } = loadConfig();
    return createInitialState(customCommands);
  });
  const ptyManagerRef = useRef<PtyManager | null>(null);
  const idleTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startupGraceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  if (!ptyManagerRef.current) {
    ptyManagerRef.current = new PtyManager();
  }

  const ptyManager = ptyManagerRef.current;
  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId),
    [state.activeTabId, state.tabs],
  );
  const activeMouseTrackingMode = activeTab?.terminalModes.mouseTrackingMode ?? "none";
  const activeSendFocusMode = activeTab?.terminalModes.sendFocusMode ?? false;
  const activeAlternateScrollMode = activeTab?.terminalModes.alternateScrollMode ?? false;
  const activeMousePassthroughEnabled =
    activeMouseTrackingMode !== "none" || activeAlternateScrollMode;

  const focusModeRef = useRef(state.focusMode);
  focusModeRef.current = state.focusMode;

  const activeTabIdRef = useRef(state.activeTabId);
  activeTabIdRef.current = state.activeTabId;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const contentOriginRef = useRef<TerminalContentOrigin>({ x: 0, y: 0, cols: 0, rows: 0 });

  useEffect(() => {
    const handler = createRawInputHandler({
      getFocusMode: () => focusModeRef.current,
      getActiveTabId: () => activeTabIdRef.current,
      getContentOrigin: () => contentOriginRef.current,
      getMousePassthroughEnabled: () => {
        const terminalModes = activeTabRef.current?.terminalModes;
        return !!terminalModes && (
          terminalModes.mouseTrackingMode !== "none" || terminalModes.alternateScrollMode
        );
      },
      writeToPty: (tabId, data) => ptyManager.write(tabId, data),
      leaveTerminalInput: () =>
        dispatch({ type: "set-focus-mode", focusMode: "navigation" }),
    });

    renderer.prependInputHandler(handler);
    return () => renderer.removeInputHandler(handler);
  }, [renderer, ptyManager]);

  useEffect(() => {
    const shouldPassthroughTerminalInput =
      state.focusMode === "terminal-input"
      && !!activeTab
      && (activeMousePassthroughEnabled || activeSendFocusMode);

    if (shouldPassthroughTerminalInput) {
      renderer.useMouse = false;
      process.stdout.write(
        `${DISABLE_TERMINAL_PASSTHROUGH}${buildTerminalPassthroughEnableSequence({
          mouseTrackingMode: activeMouseTrackingMode,
          sendFocusMode: activeSendFocusMode,
          alternateScrollMode: activeAlternateScrollMode,
        })}`,
      );
      return;
    }

    process.stdout.write(DISABLE_TERMINAL_PASSTHROUGH);
    renderer.useMouse = true;
  }, [
    activeAlternateScrollMode,
    activeMousePassthroughEnabled,
    activeMouseTrackingMode,
    activeSendFocusMode,
    activeTab?.id,
    renderer,
    state.focusMode,
  ]);

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
    const handleRender = (
      tabId: string,
      viewport: TabSession["viewport"],
      terminalModes: TerminalModeState,
    ) => {
      if (!viewport) {
        return;
      }

      dispatch({ type: "replace-tab-viewport", tabId, viewport, terminalModes });
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
    const reservedRows =
      MAIN_AREA_VERTICAL_PADDING + STATUS_BAR_HEIGHT + TERMINAL_PANE_VERTICAL_CHROME;
    const cols = Math.max(MIN_TERMINAL_COLS, Math.floor(dimensions.width - sidebarWidth - MAIN_AREA_HORIZONTAL_CHROME));
    const rows = Math.max(MIN_TERMINAL_ROWS, Math.floor(dimensions.height - reservedRows));

    // Terminal content origin in 0-based screen cells.
    // X: root padding(1) + sidebar outer(sidebarWidth) + terminal border(1) + terminal padding(1)
    // Y: root padding(1) + terminal border(1) + terminal padding(1)
    contentOriginRef.current = {
      x: 1 + sidebarWidth + 1 + 1,
      y: 1 + 1 + 1,
      cols,
      rows,
    };

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
    const customCommand = state.customCommands[assistant];
    const tab = createTabSession(assistant, customCommand);
    dispatch({ type: "add-tab", tab });
    startStartupGrace(tab.id);

    const { executable, args } = parseCommand(tab.command);

    if (!isCommandAvailable(executable)) {
      clearStartupGrace(tab.id);
      dispatch({
        type: "set-tab-error",
        tabId: tab.id,
        message: `[command not found] ${executable} is not available in PATH.`,
      });
      return;
    }

    ptyManager.createSession({
      tabId: tab.id,
      command: executable,
      args,
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
      case "begin-command-edit":
        dispatch({ type: "begin-command-edit" });
        return;
      case "command-edit-input":
        dispatch({ type: "update-command-edit", char: intent.char });
        return;
      case "commit-command-edit": {
        dispatch({ type: "commit-command-edit" });
        const option = ASSISTANT_OPTIONS[state.modal.selectedIndex];
        if (option && state.modal.editBuffer !== null) {
          const trimmed = state.modal.editBuffer.trim();
          const newCustomCommands = { ...state.customCommands };
          if (trimmed) {
            newCustomCommands[option.id] = trimmed;
          } else {
            delete newCustomCommands[option.id];
          }
          saveConfig({ customCommands: newCustomCommands });
        }
        return;
      }
      case "cancel-command-edit":
        dispatch({ type: "cancel-command-edit" });
        return;
      default:
        return;
    }
  });

  return <RootView state={state} />;
}
