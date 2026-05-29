import { useEffect, useRef } from "react";

import { CreateSessionModal } from "@/components/modals/CreateSessionModal";
import { HelpModal } from "@/components/modals/HelpModal";
import { SessionPickerModal } from "@/components/modals/SessionPickerModal";
import { SnippetPickerModal } from "@/components/modals/SnippetPickerModal";
import { TextFieldModal } from "@/components/modals/TextFieldModal";
import { ThemePickerModal } from "@/components/modals/ThemePickerModal";
import { allAssistants, filterAssistants } from "@/lib/assistants";
import { theme } from "@/lib/theme";
import type {
  DirectoryResultLite,
  GuiHelpEntry,
  ModalProjection,
  SessionRecordLite,
  SnippetRecordLite,
  WorktreeLite,
} from "@/lib/types";

interface ModalHostProps {
  modal: ModalProjection;
  customCommands: Record<string, string>;
  worktrees: WorktreeLite[];
  sessions: SessionRecordLite[];
  currentSessionId: string | null;
  snippets: SnippetRecordLite[];
  themeId: string;
  helpEntries: GuiHelpEntry[];
  directoryResults: DirectoryResultLite[];
}

// Renders modal overlays. Input is driven by the host's keymap pipeline (the
// browser forwards keys); these components are display-only. Phase 3 adds the
// remaining modals (pickers, etc.); for now: new-tab.
export function ModalHost({
  modal,
  customCommands,
  worktrees,
  sessions,
  currentSessionId,
  snippets,
  themeId,
  helpEntries,
  directoryResults,
}: ModalHostProps) {
  if (modal.type === null) {
    return null;
  }
  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-[8vh]">
      <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} />
      <div
        className="relative flex max-h-[84vh] w-[34rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border font-mono text-xs shadow-2xl"
        style={{
          backgroundColor: theme.backgroundPanel,
          borderColor: theme.border,
          color: theme.text,
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          {modal.type === "new-tab" ? (
          <NewTabModal modal={modal} customCommands={customCommands} worktrees={worktrees} />
        ) : modal.type === "split-picker" ? (
          <SplitPickerModal modal={modal} customCommands={customCommands} />
        ) : modal.type === "session-picker" ? (
          <SessionPickerModal
            modal={modal}
            sessions={sessions}
            currentSessionId={currentSessionId}
          />
        ) : modal.type === "snippet-picker" ? (
          <SnippetPickerModal modal={modal} snippets={snippets} />
        ) : modal.type === "theme-picker" ? (
          <ThemePickerModal modal={modal} themeId={themeId} />
        ) : modal.type === "help" ? (
          <HelpModal modal={modal} helpEntries={helpEntries} />
        ) : modal.type === "rename-tab" ? (
          <TextFieldModal modal={modal} title="Rename tab" />
        ) : modal.type === "session-name" ? (
          <TextFieldModal modal={modal} title="Workspace name" />
        ) : modal.type === "create-session" ? (
          <CreateSessionModal modal={modal} directoryResults={directoryResults} />
        ) : (
            <div style={{ color: theme.textMuted }}>{modal.type} (UI coming soon)</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FilterField({ value }: { value: string | null }) {
  return (
    <div
      className="rounded px-2 py-1"
      style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
    >
      {value !== null && value !== "" ? (
        value
      ) : (
        <span style={{ color: theme.textMuted }}>type to filter…</span>
      )}
      <span style={{ color: theme.primary }}>▏</span>
    </div>
  );
}

export function Empty() {
  return (
    <div className="px-2 py-1" style={{ color: theme.textMuted }}>
      no match
    </div>
  );
}

export function Footer({ text }: { text: string }) {
  return (
    <div className="pt-1" style={{ color: theme.textMuted }}>
      {text}
    </div>
  );
}

export function Row({ selected, label, hint }: { selected: boolean; label: string; hint?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);
  return (
    <div
      ref={ref}
      className="flex items-center gap-2 rounded px-2 py-1"
      style={{ backgroundColor: selected ? theme.backgroundElement : "transparent" }}
    >
      <span style={{ color: selected ? theme.primary : theme.textMuted }}>
        {selected ? "›" : " "}
      </span>
      <span style={{ color: selected ? theme.text : theme.textMuted }}>{label}</span>
      {hint !== undefined ? (
        <span className="ml-auto truncate" style={{ color: theme.textMuted }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function SplitPickerModal({
  modal,
  customCommands,
}: {
  modal: ModalProjection;
  customCommands: Record<string, string>;
}) {
  const options = filterAssistants(allAssistants(customCommands), modal.editBuffer);
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Split pane</div>
      <div
        className="rounded px-2 py-1"
        style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
      >
        {modal.editBuffer !== null && modal.editBuffer !== "" ? (
          modal.editBuffer
        ) : (
          <span style={{ color: theme.textMuted }}>type to filter…</span>
        )}
        <span style={{ color: theme.primary }}>▏</span>
      </div>
      <div className="flex flex-col">
        {options.map((option, index) => (
          <Row
            key={option.id}
            selected={index === modal.selectedIndex}
            label={option.label}
            hint={option.description}
          />
        ))}
        {options.length === 0 ? (
          <div className="px-2 py-1" style={{ color: theme.textMuted }}>
            no match
          </div>
        ) : null}
      </div>
      <div className="pt-1" style={{ color: theme.textMuted }}>
        ↑/↓ or C-p/C-n select · Enter split · Esc cancel
      </div>
    </div>
  );
}

function NewTabModal({
  modal,
  customCommands,
  worktrees,
}: {
  modal: ModalProjection;
  customCommands: Record<string, string>;
  worktrees: WorktreeLite[];
}) {
  // Step 2: choose a worktree to launch in (or create a new one).
  if (modal.step === "worktree" || modal.step === "worktree-create") {
    const assistant = modal.selectedAssistantId ?? "assistant";
    return (
      <div className="flex flex-col gap-2">
        <div className="font-bold">
          New {assistant} tab <span style={{ color: theme.textMuted }}>· choose worktree</span>
        </div>
        {modal.createWorktree === true ? (
          <div
            className="rounded px-2 py-1"
            style={{ backgroundColor: theme.backgroundElement }}
          >
            new worktree: <span style={{ color: theme.primary }}>{modal.worktreeName ?? ""}</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {worktrees.map((wt, index) => (
              <Row key={wt.id} selected={index === modal.selectedIndex} label={wt.name} />
            ))}
            {worktrees.length === 0 ? (
              <div className="px-2 py-1" style={{ color: theme.textMuted }}>
                (current directory)
              </div>
            ) : null}
          </div>
        )}
        <div className="pt-1" style={{ color: theme.textMuted }}>
          Enter: launch · C-w: toggle new worktree · ↑/↓: select · Esc: back
        </div>
      </div>
    );
  }

  // Step 1: pick an assistant.
  const options = filterAssistants(allAssistants(customCommands), modal.editBuffer);
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">New tab</div>
      <div
        className="rounded px-2 py-1"
        style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
      >
        {modal.editBuffer !== null && modal.editBuffer !== "" ? (
          modal.editBuffer
        ) : (
          <span style={{ color: theme.textMuted }}>type to filter…</span>
        )}
        <span style={{ color: theme.primary }}>▏</span>
      </div>
      <div className="flex flex-col">
        {options.map((option, index) => (
          <Row
            key={option.id}
            selected={index === modal.selectedIndex}
            label={option.label}
            hint={option.description}
          />
        ))}
        {options.length === 0 ? (
          <div className="px-2 py-1" style={{ color: theme.textMuted }}>
            no match
          </div>
        ) : null}
      </div>
      <div className="pt-1" style={{ color: theme.textMuted }}>
        ↑/↓ or C-p/C-n select · Enter next · Esc cancel
      </div>
    </div>
  );
}
