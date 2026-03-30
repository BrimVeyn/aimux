import type { MouseEvent as OtuiMouseEvent } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef } from "react";

import { INPUT_DEBUG_LOG_PATH, logInputDebug } from "./debug/input-log";
import { resolveKeyIntent } from "./input/keymap";
import { encodeMouseEventForPty } from "./input/mouse-forwarding";
import { buildPtyPastePayload } from "./input/paste";
import { createRawInputHandler, type TerminalContentOrigin } from "./input/raw-input-handler";
import { loadConfig, saveConfig } from "./config";
import {
  ASSISTANT_OPTIONS,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
} from "./pty/command-registry";
import type { SessionBackend } from "./session-backend/types";
import { loadSessionCatalog, saveSessionCatalog } from "./state/session-catalog";
import { createEmptyWorkspaceSnapshot, serializeWorkspace } from "./state/session-persistence";
import { appReducer, createInitialState } from "./state/store";
import type { AssistantId, SessionRecord, TabSession, TerminalModeState } from "./state/types";
import { RootView } from "./ui/root";

const IDLE_TIMEOUT_MS = 2_000;
const STARTUP_GRACE_MS = 5_000;
const MAIN_AREA_HORIZONTAL_CHROME = 4;
const MAIN_AREA_VERTICAL_PADDING = 2;
const STATUS_BAR_HEIGHT = 4;
const TERMINAL_PANE_VERTICAL_CHROME = 4;
const MIN_TERMINAL_ROWS = 1;
const MIN_TERMINAL_COLS = 20;
const WORKSPACE_SAVE_DEBOUNCE_MS = 250;

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
      isAlternateBuffer: false,
      bracketedPasteMode: false,
    },
    command: customCommand ?? option.command,
  };
}

function startTabSession(
  backend: SessionBackend,
  dispatch: (action: Parameters<typeof appReducer>[1]) => void,
  clearStartupGrace: (tabId: string) => void,
  startStartupGrace: (tabId: string) => void,
  tab: Pick<TabSession, "id" | "assistant" | "title" | "command">,
  cols: number,
  rows: number,
): void {
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

  backend.createSession({
    tabId: tab.id,
    assistant: tab.assistant,
    title: tab.title,
    command: executable,
    args,
    cols,
    rows,
  });
}

export function App({ backend }: { backend: SessionBackend }) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const { customCommands } = loadConfig();
    return createInitialState(customCommands, loadSessionCatalog(), true);
  });
  const idleTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startupGraceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const workspaceSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachRequestIdRef = useRef(0);
  const resizingRef = useRef(false);
  const resizingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId),
    [state.activeTabId, state.tabs],
  );
  const currentSession = useMemo(
    () => state.sessions.find((session) => session.id === state.currentSessionId),
    [state.currentSessionId, state.sessions],
  );
  const activeMouseForwardingEnabled = activeTab?.terminalModes.mouseTrackingMode !== "none";
  const activeLocalScrollbackEnabled =
    !!activeTab && !activeMouseForwardingEnabled && !activeTab.terminalModes.isAlternateBuffer;

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
      getMousePassthroughEnabled: () => activeTabRef.current !== undefined,
      getBracketedPasteModeEnabled: () =>
        activeTabRef.current?.terminalModes.bracketedPasteMode ?? false,
      writeToPty: (tabId, data) => {
        const viewport = activeTabRef.current?.viewport;
        if (viewport && viewport.viewportY < viewport.baseY) {
          backend.scrollViewportToBottom(tabId);
        }
        backend.write(tabId, data);
      },
      leaveTerminalInput: () => dispatch({ type: "set-focus-mode", focusMode: "navigation" }),
      toggleSidebar: () => dispatch({ type: "toggle-sidebar" }),
    });

    renderer.prependInputHandler(handler);
    return () => renderer.removeInputHandler(handler);
  }, [backend, renderer]);

  useEffect(() => {
    const handlePasteEvent = (event: { bytes: Uint8Array; defaultPrevented?: boolean }) => {
      logInputDebug("app.rendererPaste", {
        defaultPrevented: event.defaultPrevented ?? false,
        byteLength: event.bytes.length,
      });

      if (event.defaultPrevented) {
        return;
      }

      handleTerminalPaste(event);
    };

    renderer.keyInput.on("paste", handlePasteEvent);
    return () => {
      renderer.keyInput.off("paste", handlePasteEvent);
    };
  }, [renderer, state.activeTabId, state.focusMode, activeTab]);

  useEffect(() => {
    const handleSelection = (selection: { isDragging?: boolean; getSelectedText(): string }) => {
      const selectedText = selection.getSelectedText();
      logInputDebug("app.selection", {
        isDragging: selection.isDragging ?? false,
        textLength: selectedText.length,
        osc52Supported: renderer.isOsc52Supported(),
      });

      if (selection.isDragging || selectedText.length === 0) {
        return;
      }

      renderer.copyToClipboardOSC52(selectedText);
    };

    renderer.on("selection", handleSelection);
    return () => {
      renderer.off("selection", handleSelection);
    };
  }, [renderer]);

  useEffect(() => {
    renderer.useMouse = true;
  }, [renderer]);

  useEffect(() => {
    renderer.useConsole = false;
    renderer.console.hide();
    renderer.console.show = () => {};
  }, [renderer]);

  useEffect(() => {
    const shouldEnableBracketedPaste = state.focusMode === "terminal-input" && !!state.activeTabId;
    logInputDebug("app.bracketedPasteMode", {
      enabled: shouldEnableBracketedPaste,
      activeTabId: state.activeTabId,
      focusMode: state.focusMode,
      logPath: INPUT_DEBUG_LOG_PATH,
    });
    process.stdout.write(shouldEnableBracketedPaste ? "\x1b[?2004h" : "\x1b[?2004l");

    return () => {
      process.stdout.write("\x1b[?2004l");
    };
  }, [state.activeTabId, state.focusMode]);

  const handleTerminalMouseEvent = (event: OtuiMouseEvent, origin: TerminalContentOrigin) => {
    if (
      state.focusMode !== "terminal-input" ||
      !state.activeTabId ||
      !activeMouseForwardingEnabled
    ) {
      return;
    }

    const sequence = encodeMouseEventForPty(event, origin);
    if (!sequence) {
      return;
    }

    backend.write(state.activeTabId, sequence);
  };

  const handleTerminalScrollEvent = (event: OtuiMouseEvent) => {
    if (state.focusMode !== "terminal-input" || !state.activeTabId) {
      return;
    }

    if (activeMouseForwardingEnabled) {
      return;
    }

    if (!activeLocalScrollbackEnabled || event.type !== "scroll") {
      return;
    }

    const direction = event.scroll?.direction;
    if (direction === "up") {
      backend.scrollViewport(state.activeTabId, -3);
    } else if (direction === "down") {
      backend.scrollViewport(state.activeTabId, 3);
    }
  };

  const handleTerminalPaste = (event: { bytes: Uint8Array }) => {
    logInputDebug("app.onTerminalPaste", {
      activeTabId: state.activeTabId,
      focusMode: state.focusMode,
      byteLength: event.bytes.length,
      decodedPreview: new TextDecoder().decode(event.bytes).slice(0, 120),
      bracketedPasteMode: activeTab?.terminalModes.bracketedPasteMode ?? false,
    });

    if (state.focusMode !== "terminal-input" || !state.activeTabId || !activeTab) {
      return;
    }

    if (activeTab.viewport && activeTab.viewport.viewportY < activeTab.viewport.baseY) {
      backend.scrollViewportToBottom(state.activeTabId);
    }

    const payload = new TextDecoder().decode(event.bytes);
    backend.write(
      state.activeTabId,
      buildPtyPastePayload(payload, activeTab.terminalModes.bracketedPasteMode),
    );
  };

  useEffect(() => {
    if (!state.currentSessionId) {
      return;
    }

    backend.setActiveTab(state.activeTabId);
  }, [backend, state.activeTabId, state.currentSessionId]);

  useEffect(() => {
    const currentSessionId = state.currentSessionId;
    if (!currentSessionId) {
      attachRequestIdRef.current += 1;
      return;
    }

    const attachRequestId = attachRequestIdRef.current + 1;
    attachRequestIdRef.current = attachRequestId;
    let cancelled = false;

    void backend
      .attach({
        sessionId: currentSessionId,
        cols: state.layout.terminalCols,
        rows: state.layout.terminalRows,
        workspaceSnapshot: currentSession?.workspaceSnapshot,
      })
      .then((result) => {
        if (cancelled || attachRequestIdRef.current !== attachRequestId) {
          return;
        }
        logInputDebug("app.backend.attachResult", {
          hasResult: !!result,
          tabs: result?.tabs.length ?? 0,
          activeTabId: result?.activeTabId ?? null,
        });
        if (result) {
          dispatch({
            type: "hydrate-workspace",
            tabs: result.tabs,
            activeTabId: result.activeTabId,
          });
        } else if (currentSession?.workspaceSnapshot) {
          dispatch({
            type: "load-session",
            sessionId: currentSessionId,
            workspaceSnapshot: currentSession.workspaceSnapshot,
          });
        }
      })
      .catch((error) => {
        if (cancelled || attachRequestIdRef.current !== attachRequestId) {
          return;
        }
        logInputDebug("app.backend.attachError", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (currentSession?.workspaceSnapshot) {
          dispatch({
            type: "load-session",
            sessionId: currentSessionId,
            workspaceSnapshot: currentSession.workspaceSnapshot,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backend, currentSession?.workspaceSnapshot, state.currentSessionId]);

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
    if (workspaceSaveTimeoutRef.current) {
      clearTimeout(workspaceSaveTimeoutRef.current);
    }

    workspaceSaveTimeoutRef.current = setTimeout(() => {
      const sessionsToSave = state.sessions.map((session) =>
        session.id === state.currentSessionId
          ? {
              ...session,
              updatedAt: new Date().toISOString(),
              workspaceSnapshot: serializeWorkspace(state),
            }
          : session,
      );
      saveConfig({
        ...loadConfig(),
        customCommands: state.customCommands,
      });
      saveSessionCatalog(sessionsToSave);
      workspaceSaveTimeoutRef.current = null;
    }, WORKSPACE_SAVE_DEBOUNCE_MS);

    return () => {
      if (workspaceSaveTimeoutRef.current) {
        clearTimeout(workspaceSaveTimeoutRef.current);
        workspaceSaveTimeoutRef.current = null;
        const sessionsToSave = state.sessions.map((session) =>
          session.id === state.currentSessionId
            ? {
                ...session,
                updatedAt: new Date().toISOString(),
                workspaceSnapshot: serializeWorkspace(state),
              }
            : session,
        );
        saveConfig({
          ...loadConfig(),
          customCommands: state.customCommands,
        });
        saveSessionCatalog(sessionsToSave);
      }
    };
  }, [state]);

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
      if (isStartupGraceActive(tabId) || resizingRef.current) {
        return;
      }

      dispatch({ type: "set-tab-activity", tabId, activity: "busy" });
      scheduleIdle(tabId);
    };

    const handleExit = (tabId: string, exitCode: number) => {
      clearIdleTimer(tabId);
      clearStartupGrace(tabId);
      dispatch({ type: "set-tab-status", tabId, status: "exited", exitCode });
      dispatch({ type: "set-tab-activity", tabId, activity: undefined });
    };

    const handleError = (tabId: string, message: string) => {
      clearIdleTimer(tabId);
      clearStartupGrace(tabId);
      dispatch({ type: "set-tab-error", tabId, message });
    };

    backend.on("render", handleRender);
    backend.on("exit", handleExit);
    backend.on("error", handleError);

    return () => {
      for (const timeout of idleTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      idleTimeoutsRef.current.clear();
      for (const timeout of startupGraceTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      startupGraceTimeoutsRef.current.clear();
      if (workspaceSaveTimeoutRef.current) {
        clearTimeout(workspaceSaveTimeoutRef.current);
      }
      backend.off("render", handleRender);
      backend.off("exit", handleExit);
      backend.off("error", handleError);
      void backend.destroy(true);
    };
  }, [backend]);

  const terminalSize = useMemo(() => {
    const sidebarWidth = state.sidebar.visible ? state.sidebar.width + 3 : 0;
    const reservedRows =
      MAIN_AREA_VERTICAL_PADDING + STATUS_BAR_HEIGHT + TERMINAL_PANE_VERTICAL_CHROME;
    const cols = Math.max(
      MIN_TERMINAL_COLS,
      Math.floor(dimensions.width - sidebarWidth - MAIN_AREA_HORIZONTAL_CHROME),
    );
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
    resizingRef.current = true;
    if (resizingTimerRef.current) {
      clearTimeout(resizingTimerRef.current);
    }
    backend.resizeAll(terminalSize.cols, terminalSize.rows);
    resizingTimerRef.current = setTimeout(() => {
      resizingRef.current = false;
      resizingTimerRef.current = null;
    }, 500);
  }, [backend, terminalSize.cols, terminalSize.rows]);

  function launchAssistant(assistant: AssistantId) {
    const customCommand = state.customCommands[assistant];
    const tab = createTabSession(assistant, customCommand);
    logInputDebug("app.launchAssistant", {
      assistant,
      tabId: tab.id,
      command: tab.command,
    });
    dispatch({ type: "add-tab", tab });
    startTabSession(
      backend,
      dispatch,
      clearStartupGrace,
      startStartupGrace,
      tab,
      state.layout.terminalCols,
      state.layout.terminalRows,
    );
  }

  function createSessionFromCurrent(name: string): void {
    const now = new Date().toISOString();
    const workspaceSnapshot =
      state.currentSessionId || state.tabs.length === 0
        ? createEmptyWorkspaceSnapshot()
        : serializeWorkspace(state);
    const session: SessionRecord = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      workspaceSnapshot,
    };
    let updatedSessions = state.sessions;
    if (state.currentSessionId) {
      const currentSnapshot = serializeWorkspace(state);
      updatedSessions = state.sessions.map((s) =>
        s.id === state.currentSessionId
          ? { ...s, updatedAt: now, workspaceSnapshot: currentSnapshot }
          : s,
      );
    }
    const sessions = [...updatedSessions, session];
    logInputDebug("app.session.create", {
      sessionId: session.id,
      name,
      fromCurrentWorkspace: !state.currentSessionId && state.tabs.length > 0,
      tabCount: workspaceSnapshot.tabs.length,
    });
    saveSessionCatalog(sessions);
    dispatch({ type: "set-sessions", sessions });
    dispatch({
      type: "load-session",
      sessionId: session.id,
      workspaceSnapshot: session.workspaceSnapshot,
    });
  }

  function renameSession(sessionId: string, name: string): void {
    logInputDebug("app.session.rename", { sessionId, name });
    const sessions = state.sessions.map((session) =>
      session.id === sessionId
        ? { ...session, name, updatedAt: new Date().toISOString() }
        : session,
    );
    saveSessionCatalog(sessions);
    dispatch({ type: "rename-session-record", sessionId, name });
  }

  function switchToSession(session: SessionRecord): void {
    logInputDebug("app.session.switch.start", {
      fromSessionId: state.currentSessionId,
      toSessionId: session.id,
      toName: session.name,
      currentTabCount: state.tabs.length,
      restoredTabCount: session.workspaceSnapshot?.tabs.length ?? 0,
    });
    const currentSnapshot = state.currentSessionId ? serializeWorkspace(state) : undefined;
    const sessions = state.sessions.map((entry) => {
      if (entry.id === state.currentSessionId && currentSnapshot) {
        return {
          ...entry,
          updatedAt: new Date().toISOString(),
          workspaceSnapshot: currentSnapshot,
        };
      }
      if (entry.id === session.id) {
        return { ...entry, lastOpenedAt: new Date().toISOString() };
      }
      return entry;
    });
    saveSessionCatalog(sessions);
    void backend.destroy(true);
    dispatch({ type: "set-sessions", sessions });
    dispatch({
      type: "load-session",
      sessionId: session.id,
      workspaceSnapshot: session.workspaceSnapshot,
    });
    logInputDebug("app.session.switch.dispatched", {
      toSessionId: session.id,
    });
  }

  function deleteSession(sessionId: string): void {
    const remaining = state.sessions.filter((session) => session.id !== sessionId);
    logInputDebug("app.session.delete", {
      sessionId,
      wasCurrent: sessionId === state.currentSessionId,
      remainingCount: remaining.length,
    });
    saveSessionCatalog(remaining);
    if (sessionId === state.currentSessionId) {
      void backend.destroy(true);
    }
    dispatch({ type: "delete-session-record", sessionId });
  }

  function restartTab(tab: TabSession): void {
    logInputDebug("app.restartTab", {
      tabId: tab.id,
      command: tab.command,
      status: tab.status,
    });
    clearIdleTimer(tab.id);
    clearStartupGrace(tab.id);
    backend.disposeSession(tab.id);
    dispatch({ type: "reset-tab-session", tabId: tab.id });
    startTabSession(
      backend,
      dispatch,
      clearStartupGrace,
      startStartupGrace,
      tab,
      state.layout.terminalCols,
      state.layout.terminalRows,
    );
  }

  useKeyboard((key) => {
    const intent = resolveKeyIntent(key, state.focusMode);
    if (!intent) {
      return;
    }

    key.preventDefault();

    switch (intent.type) {
      case "quit":
        saveConfig({
          ...loadConfig(),
          customCommands: state.customCommands,
        });
        saveSessionCatalog(
          state.sessions.map((session) =>
            session.id === state.currentSessionId
              ? {
                  ...session,
                  updatedAt: new Date().toISOString(),
                  workspaceSnapshot: serializeWorkspace(state),
                }
              : session,
          ),
        );
        void backend.destroy(true);
        renderer.destroy();
        process.exit(0);
        return;
      case "open-new-tab-modal":
        dispatch({ type: "open-new-tab-modal" });
        return;
      case "open-help-modal":
        dispatch({ type: "open-help-modal" });
        return;
      case "open-session-picker":
        dispatch({ type: "open-session-picker" });
        return;
      case "close-tab":
        if (state.activeTabId) {
          clearIdleTimer(state.activeTabId);
          clearStartupGrace(state.activeTabId);
          backend.disposeSession(state.activeTabId);
          dispatch({ type: "close-tab", tabId: state.activeTabId });
        }
        return;
      case "close-modal":
        if (state.modal.type === "session-picker" && !state.currentSessionId) {
          return;
        }
        dispatch({ type: "close-modal" });
        return;
      case "confirm-modal": {
        if (state.modal.type === "new-tab") {
          const option = getAssistantOption(state.modal.selectedIndex);
          launchAssistant(option.id);
          return;
        }

        if (state.modal.type === "session-picker") {
          logInputDebug("app.sessionPicker.confirm", {
            selectedIndex: state.modal.selectedIndex,
            selectedSessionId: state.sessions[state.modal.selectedIndex]?.id ?? null,
            creatingNew: state.modal.selectedIndex === state.sessions.length,
          });
          const selectedSession = state.sessions[state.modal.selectedIndex];
          if (selectedSession) {
            switchToSession(selectedSession);
          } else {
            dispatch({ type: "open-session-name-modal", initialName: "" });
          }
        }
        return;
      }
      case "move-modal-selection":
        dispatch({ type: "move-modal-selection", delta: intent.delta });
        return;
      case "create-new-session":
        dispatch({ type: "open-session-name-modal", initialName: "" });
        return;
      case "rename-selected-session":
        if (state.modal.type === "session-picker") {
          const selectedSession = state.sessions[state.modal.selectedIndex];
          if (selectedSession) {
            logInputDebug("app.sessionPicker.openRenameModal", {
              selectedIndex: state.modal.selectedIndex,
              selectedSessionId: selectedSession.id,
            });
            dispatch({
              type: "open-session-name-modal",
              sessionTargetId: selectedSession.id,
              initialName: selectedSession.name,
            });
          }
        }
        return;
      case "delete-selected-session":
        if (state.modal.type === "session-picker") {
          const selectedSession = state.sessions[state.modal.selectedIndex];
          logInputDebug("app.sessionPicker.deleteSelected", {
            selectedIndex: state.modal.selectedIndex,
            selectedSessionId: selectedSession?.id ?? null,
          });
          if (selectedSession) {
            deleteSession(selectedSession.id);
          }
        }
        return;
      case "move-tab":
        dispatch({ type: "move-active-tab", delta: intent.delta });
        return;
      case "reorder-tab":
        dispatch({ type: "reorder-active-tab", delta: intent.delta });
        return;
      case "restart-tab":
        if (activeTab) {
          restartTab(activeTab);
        }
        return;
      case "enter-terminal-input":
        if (state.activeTabId) {
          dispatch({ type: "set-focus-mode", focusMode: "terminal-input" });
        }
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
        if (state.modal.type === "session-name" && state.modal.editBuffer !== null) {
          const trimmed = state.modal.editBuffer.trim();
          logInputDebug("app.sessionName.commit", {
            sessionTargetId: state.modal.sessionTargetId ?? null,
            value: trimmed,
          });
          if (trimmed) {
            if (state.modal.sessionTargetId) {
              renameSession(state.modal.sessionTargetId, trimmed);
              return;
            }
            createSessionFromCurrent(trimmed);
          }
          dispatch({ type: "close-modal" });
          return;
        }
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
          saveConfig({
            ...loadConfig(),
            customCommands: newCustomCommands,
          });
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

  return (
    <RootView
      state={state}
      contentOrigin={contentOriginRef.current}
      mouseForwardingEnabled={activeMouseForwardingEnabled}
      localScrollbackEnabled={activeLocalScrollbackEnabled}
      onTerminalMouseEvent={handleTerminalMouseEvent}
      onTerminalScrollEvent={handleTerminalScrollEvent}
    />
  );
}
