import { ASSISTANT_OPTIONS } from "../../pty/command-registry";
import { theme } from "../theme";

interface NewTabModalProps {
  selectedIndex: number;
}

export function NewTabModal({ selectedIndex }: NewTabModalProps) {
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
        <text fg={theme.textMuted}>Use j/k or arrows, Enter to confirm, Esc to cancel.</text>
        {ASSISTANT_OPTIONS.map((option, index) => {
          const active = index === selectedIndex;

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
            </box>
          );
        })}
      </box>
    </box>
  );
}
