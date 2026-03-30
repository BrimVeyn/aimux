import { ASSISTANT_OPTIONS } from "../../pty/command-registry";
import type { AssistantId } from "../../state/types";
import { theme } from "../theme";

interface NewTabModalProps {
  selectedIndex: number;
  customCommands: Record<AssistantId, string>;
  editBuffer: string | null;
}

export function NewTabModal({ selectedIndex, customCommands, editBuffer }: NewTabModalProps) {
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
        width={48}
        border
        borderColor={theme.borderActive}
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accent}>New assistant tab</text>
        {editBuffer !== null ? (
          <>
            <text fg={theme.textMuted}>
              Editing command for {ASSISTANT_OPTIONS[selectedIndex]?.label}. Enter to confirm, Esc
              to cancel.
            </text>
            <box
              border
              borderColor={theme.borderActive}
              backgroundColor={theme.panelMuted}
              padding={1}
            >
              <text fg={theme.text}>{editBuffer}_</text>
            </box>
          </>
        ) : (
          <>
            <text fg={theme.textMuted}>
              Use j/k or arrows, Enter to confirm, e to edit command, Esc to cancel.
            </text>
            {ASSISTANT_OPTIONS.map((option, index) => {
              const active = index === selectedIndex;
              const customCmd = customCommands[option.id];

              return (
                <box
                  key={option.id}
                  border
                  borderColor={active ? theme.borderActive : theme.border}
                  backgroundColor={active ? theme.panelMuted : theme.background}
                  padding={1}
                  flexDirection="column"
                >
                  <text fg={active ? theme.text : theme.textMuted}>
                    {active ? ">" : " "} {option.label}
                  </text>
                  <text fg={theme.textMuted}>{option.description}</text>
                  {customCmd ? <text fg={theme.accent}>{customCmd}</text> : null}
                </box>
              );
            })}
          </>
        )}
      </box>
    </box>
  );
}
