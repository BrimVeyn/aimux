import { homedir } from "node:os";

import { theme } from "../theme";

interface DirectoryResult {
  path: string;
  isWorktree: boolean;
}

interface CreateSessionModalProps {
  activeField: "directory" | "name";
  directoryQuery: string;
  sessionName: string;
  results: DirectoryResult[];
  selectedIndex: number;
  pendingProjectPath: string | null;
}

function abbreviatePath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function CreateSessionModal({
  activeField,
  directoryQuery,
  sessionName,
  results,
  selectedIndex,
  pendingProjectPath,
}: CreateSessionModalProps) {
  const dirActive = activeField === "directory";
  const nameActive = activeField === "name";

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        width="60%"
        border
        borderColor={theme.borderActive}
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accentAlt}>Create session</text>
        <text fg={theme.textMuted}>Tab switch field. Ctrl+n/p nav. Esc cancel.</text>

        <text fg={dirActive ? theme.text : theme.textMuted}>Search git repos:</text>
        <box
          border
          borderColor={dirActive ? theme.borderActive : theme.border}
          backgroundColor={dirActive ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={dirActive ? theme.text : theme.textMuted}>
            {pendingProjectPath && !dirActive ? abbreviatePath(pendingProjectPath) : directoryQuery}
            {dirActive ? "_" : ""}
          </text>
        </box>

        {dirActive && results.length === 0 && directoryQuery.length > 0 ? (
          <text fg={theme.textMuted}>No matches</text>
        ) : null}
        {dirActive
          ? results.map((result, index) => {
              const active = index === selectedIndex;
              const icon = result.isWorktree ? "\u{e728}" : "\u{e702}";
              const iconColor = result.isWorktree ? theme.warning : theme.accent;
              return (
                <box key={result.path} flexDirection="row">
                  <text fg={active ? theme.text : theme.textMuted}>{active ? ">" : " "} </text>
                  <text fg={iconColor}>{icon} </text>
                  <text fg={active ? theme.text : theme.textMuted}>
                    {abbreviatePath(result.path)}
                  </text>
                </box>
              );
            })
          : null}

        <text fg={nameActive ? theme.text : theme.textMuted}>Session name:</text>
        <box
          border
          borderColor={nameActive ? theme.borderActive : theme.border}
          backgroundColor={nameActive ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={nameActive ? theme.text : theme.textMuted}>
            {sessionName}
            {nameActive ? "_" : ""}
          </text>
        </box>
      </box>
    </box>
  );
}
