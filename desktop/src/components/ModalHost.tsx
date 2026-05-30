import { useEffect, useRef } from "react";

import { AIUsageModal } from "@/components/AIUsageModal";
import { CreateSessionModal } from "@/components/modals/CreateSessionModal";
import { GitCommitModal } from "@/components/modals/GitCommitModal";
import { HelpModal } from "@/components/modals/HelpModal";
import { SessionPickerModal } from "@/components/modals/SessionPickerModal";
import { SnippetEditorModal } from "@/components/modals/SnippetEditorModal";
import { SnippetPickerModal } from "@/components/modals/SnippetPickerModal";
import { TextFieldModal } from "@/components/modals/TextFieldModal";
import { ThemePickerModal } from "@/components/modals/ThemePickerModal";
import { UpdateAvailableModal } from "@/components/modals/UpdateAvailableModal";
import { WorktreeMoveModal } from "@/components/modals/WorktreeMoveModal";
import { allAssistants, filterAssistants } from "@/lib/assistants";
import { formatDivergence } from "@/lib/git";
import { theme } from "@/lib/theme";
import type {
  AIUsageTool,
  DirectoryResultLite,
  GitFileEntryLite,
  GuiHelpEntry,
  ModalProjection,
  SessionRecordLite,
  SnippetRecordLite,
  UsageSnapshot,
  WorktreeLite,
} from "@/lib/types";

interface ModalHostProps {
  modal: ModalProjection;
  customCommands: Record<string, string>;
  worktrees: WorktreeLite[];
  worktreeDivergence: Record<string, { ahead: number; behind: number }>;
  sessions: SessionRecordLite[];
  currentSessionId: string | null;
  snippets: SnippetRecordLite[];
  committedThemeId: string;
  helpEntries: GuiHelpEntry[];
  aiUsageSnapshots: Partial<Record<AIUsageTool, UsageSnapshot>>;
  directoryResults: DirectoryResultLite[];
  gitFiles: GitFileEntryLite[];
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
  onToggleDeleteSource: () => void;
  onOpenSnippetEditor: (snippetId?: string) => void;
  // Roadmap P1.3: SnippetEditorModal is client-authoritative — buffers stay
  // local React state, only the committed payload travels back via these
  // intent callbacks. See desktop/src/components/modals/SnippetEditorModal.tsx
  // for the pattern.
  onSnippetSubmit: (payload: {
    name: string;
    trigger: string;
    content: string;
    snippetId?: string;
  }) => void;
  onSnippetCancel: () => void;
  // Backdrop click → same effect as Esc on the host (closes / cancels). The
  // TUI has no notion of "click outside", so this is GUI-only UX polish that
  // routes through the same keymap path Esc would take.
  onBackdropClick: () => void;
}

// Renders modal overlays. Input is driven by the host's keymap pipeline (the
// browser forwards keys); these components are display-only. Phase 3 adds the
// remaining modals (pickers, etc.); for now: new-tab.
export function ModalHost({
  modal,
  customCommands,
  worktrees,
  worktreeDivergence,
  sessions,
  currentSessionId,
  snippets,
  committedThemeId,
  helpEntries,
  aiUsageSnapshots,
  directoryResults,
  gitFiles,
  onSelect,
  onConfirm,
  onToggleDeleteSource,
  onOpenSnippetEditor,
  onSnippetSubmit,
  onSnippetCancel,
  onBackdropClick,
}: ModalHostProps) {
  if (modal.type === null) {
    return null;
  }
  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-[8vh]">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={onBackdropClick}
      />
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
          <NewTabModal
            modal={modal}
            customCommands={customCommands}
            worktrees={worktrees}
            worktreeDivergence={worktreeDivergence}
            onSelect={onSelect}
            onConfirm={onConfirm}
          />
        ) : modal.type === "split-picker" ? (
          <SplitPickerModal
            modal={modal}
            customCommands={customCommands}
            onSelect={onSelect}
            onConfirm={onConfirm}
          />
        ) : modal.type === "session-picker" ? (
          <SessionPickerModal
            modal={modal}
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelect={onSelect}
            onConfirm={onConfirm}
          />
        ) : modal.type === "snippet-picker" ? (
          <SnippetPickerModal
            modal={modal}
            snippets={snippets}
            onSelect={onSelect}
            onConfirm={onConfirm}
            onOpenEditor={onOpenSnippetEditor}
          />
        ) : modal.type === "theme-picker" ? (
          <ThemePickerModal
            modal={modal}
            committedThemeId={committedThemeId}
            onSelect={onSelect}
            onConfirm={onConfirm}
          />
        ) : modal.type === "help" ? (
          <HelpModal modal={modal} helpEntries={helpEntries} />
        ) : modal.type === "ai-usage" ? (
          <AIUsageModal snapshots={aiUsageSnapshots} />
        ) : modal.type === "rename-tab" ? (
          <TextFieldModal modal={modal} title="Rename tab" />
        ) : modal.type === "session-name" ? (
          <TextFieldModal modal={modal} title="Workspace name" />
        ) : modal.type === "create-session" ? (
          <CreateSessionModal
            modal={modal}
            directoryResults={directoryResults}
            onSelect={onSelect}
            onConfirm={onConfirm}
          />
        ) : modal.type === "worktree-move" ? (
          <WorktreeMoveModal
            modal={modal}
            sessions={sessions}
            currentSessionId={currentSessionId}
            worktreeDivergence={worktreeDivergence}
            onSelect={onSelect}
            onConfirm={onConfirm}
            onToggleDeleteSource={onToggleDeleteSource}
          />
        ) : modal.type === "git-commit" ? (
          <GitCommitModal
            modal={modal}
            stagedCount={gitFiles.filter((f) => f.section === "staged").length}
          />
        ) : modal.type === "snippet-editor" ? (
          <SnippetEditorModal modal={modal} onSubmit={onSnippetSubmit} onCancel={onSnippetCancel} />
        ) : modal.type === "update-available" ? (
          <UpdateAvailableModal modal={modal} onSelect={onSelect} onConfirm={onConfirm} />
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

export function Row({
  selected,
  label,
  hint,
  onSelect,
  onConfirm,
}: {
  selected: boolean;
  label: string;
  hint?: string;
  onSelect?: () => void;
  onConfirm?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);
  const interactive = onSelect !== undefined || onConfirm !== undefined;
  return (
    <div
      ref={ref}
      className={`flex items-center gap-2 rounded px-2 py-1${interactive ? " cursor-pointer" : ""}`}
      onMouseEnter={onSelect}
      onClick={onConfirm}
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
  onSelect,
  onConfirm,
}: {
  modal: ModalProjection;
  customCommands: Record<string, string>;
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
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
            onSelect={() => onSelect(index)}
            onConfirm={() => onConfirm(index)}
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
  worktreeDivergence,
  onSelect,
  onConfirm,
}: {
  modal: ModalProjection;
  customCommands: Record<string, string>;
  worktrees: WorktreeLite[];
  worktreeDivergence: Record<string, { ahead: number; behind: number }>;
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
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
            {worktrees.map((wt, index) => {
              const primary = wt.source === "primary" ? " (primary)" : "";
              const divergence = formatDivergence(worktreeDivergence[wt.id]);
              const primaryText =
                wt.branch !== undefined && wt.branch !== "" ? wt.branch : wt.name;
              const label = `${primaryText}${primary}${divergence !== "" ? ` ${divergence}` : ""}`;
              return (
                <Row
                  key={wt.id}
                  selected={index === modal.selectedIndex}
                  label={label}
                  onSelect={() => onSelect(index)}
                  onConfirm={() => onConfirm(index)}
                />
              );
            })}
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
            onSelect={() => onSelect(index)}
            onConfirm={() => onConfirm(index)}
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
