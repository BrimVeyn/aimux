import { useEffect, useRef, useState } from "react";

import { Footer } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
import type { ModalProjection } from "@/lib/types";

// ---------------------------------------------------------------------------
// Client-authoritative modal (roadmap P1.3 pilot).
//
// THE RULE
//   - Host owns committed state (the snippets catalog, modal.type,
//     modal.sessionTargetId).
//   - Client owns in-flight UI state (name / trigger / content buffers,
//     which field has focus). The host's projection of those buffers is
//     READ ONLY ON MOUNT and ignored afterwards.
//
// THE PATTERN
//   1. Seed React useState from the projection inside the lazy initializer
//      so a late projection update can't overwrite the user's typing.
//   2. All per-keystroke input is handled locally by React on the input
//      elements — zero WS round-trips.
//   3. Submit / cancel send a single intent (modal.snippet.submit /
//      modal.snippet.cancel); the host updates AppState and tears the modal
//      down, which unmounts this component.
//
// THE BOUNDARY
//   - Never dispatch a per-keystroke message to the host for this modal.
//   - Never read modal.editBuffer / modal.activeField after the initial
//     mount — they go stale the moment the user types.
//
// WHY
//   - Latency: typing must not block on a WS round-trip.
//   - Projection size: per-keystroke broadcasts re-encode the full
//     AppStateProjection.
//   - Divergence from the TUI's char-by-char editBuffer flow: the GUI has
//     real <input>/<textarea> elements with native selection, IME, undo,
//     accessibility, etc. — the TUI keymap-driven path is preserved
//     untouched in src/ui/components/modals/snippets/.
// ---------------------------------------------------------------------------

type Field = "name" | "trigger" | "content";

const FIELD_ORDER: Field[] = ["name", "trigger", "content"];

function readInitialField(modal: ModalProjection): Field {
  // The host's `open-snippet-editor` reducer always seeds `activeField: 'name'`,
  // but tolerate `trigger` / `content` if a future open path picks a different
  // starting field. Anything else → default to name.
  const f = modal.activeField;
  return f === "name" || f === "trigger" || f === "content" ? f : "name";
}

function readInitialBuffer(modal: ModalProjection, field: Field): string {
  // On mount the host's projection is the authoritative seed: if the active
  // field is `field`, the live value is in editBuffer; otherwise in the
  // per-field buffer. Mirrors the legacy display logic but only runs once.
  const editBuffer = modal.editBuffer ?? "";
  const nameBuffer = modal.nameBuffer ?? "";
  const triggerBuffer = modal.triggerBuffer ?? "";
  const contentBuffer = modal.contentBuffer ?? "";
  const active = readInitialField(modal);
  if (field === "name") return active === "name" ? editBuffer : nameBuffer;
  if (field === "trigger") return active === "trigger" ? editBuffer : triggerBuffer;
  return active === "content" ? editBuffer : contentBuffer;
}

export interface SnippetEditorModalCallbacks {
  onSubmit: (payload: {
    name: string;
    trigger: string;
    content: string;
    snippetId?: string;
  }) => void;
  onCancel: () => void;
}

export function SnippetEditorModal({
  modal,
  onSubmit,
  onCancel,
}: {
  modal: ModalProjection;
} & SnippetEditorModalCallbacks) {
  const isEditing = modal.sessionTargetId != null;
  // `modal.sessionTargetId` is read on every submit (the host owns this — it
  // identifies which snippet is being edited and never mutates while the
  // modal is open). A ref keeps the latest value accessible inside event
  // callbacks without re-binding handlers on every render.
  const snippetIdRef = useRef<string | null>(modal.sessionTargetId);
  snippetIdRef.current = modal.sessionTargetId;

  // Lazy initializers: seed ONCE from the projection. After this, the host's
  // editBuffer / nameBuffer / triggerBuffer / contentBuffer projections are
  // IGNORED — they only update on the legacy per-keystroke flow which is
  // dead for this modal.
  const [name, setName] = useState<string>(() => readInitialBuffer(modal, "name"));
  const [trigger, setTrigger] = useState<string>(() => readInitialBuffer(modal, "trigger"));
  const [content, setContent] = useState<string>(() => readInitialBuffer(modal, "content"));
  const [activeField, setActiveField] = useState<Field>(() => readInitialField(modal));

  const nameRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the active field on mount (and on programmatic field changes via
  // Tab / Enter cycling). Browsers don't auto-focus when a node is created
  // mid-render; we have to drive it explicitly.
  useEffect(() => {
    const el =
      activeField === "name"
        ? nameRef.current
        : activeField === "trigger"
          ? triggerRef.current
          : contentRef.current;
    el?.focus();
  }, [activeField]);

  function nextField(current: Field): Field {
    const i = FIELD_ORDER.indexOf(current);
    return FIELD_ORDER[(i + 1) % FIELD_ORDER.length] ?? "name";
  }

  function prevField(current: Field): Field {
    const i = FIELD_ORDER.indexOf(current);
    const n = FIELD_ORDER.length;
    return FIELD_ORDER[(i - 1 + n) % n] ?? "name";
  }

  function submit(): void {
    const id = snippetIdRef.current;
    onSubmit({
      content,
      name,
      ...(id != null && id !== "" ? { snippetId: id } : {}),
      trigger,
    });
    // Don't optimistically close — wait for the host's `close-modal`
    // projection update so reducer + UI stay in lockstep.
  }

  function handleSingleLineKey(field: Field, e: React.KeyboardEvent<HTMLInputElement>): void {
    // Stop App.tsx's window-level keydown from also forwarding these keys to
    // the host (which would mutate the now-dead modal.editBuffer flow and,
    // for Enter, fire saveSnippetEditor against an empty host buffer).
    e.stopPropagation();
    if (e.key === "Tab") {
      e.preventDefault();
      setActiveField(e.shiftKey ? prevField(field) : nextField(field));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "content") return; // content uses textarea; never reaches here
      // Name / trigger: move to the next field; on the last single-line field
      // before content, this also advances to content (not submit) — content
      // is required and the user needs to fill it.
      setActiveField(nextField(field));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
  }

  function handleContentKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    e.stopPropagation();
    if (e.key === "Tab") {
      e.preventDefault();
      // From content: forward Tab → name (wraps), Shift+Tab → trigger (previous).
      setActiveField(e.shiftKey ? prevField("content") : nextField("content"));
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    // Plain Enter inserts a newline — default textarea behavior, no preventDefault.
  }

  const nameActive = activeField === "name";
  const triggerActive = activeField === "trigger";
  const contentActive = activeField === "content";

  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">{isEditing ? "Edit snippet" : "Create snippet"}</div>

      <EditableField
        active={nameActive}
        inputRef={nameRef}
        label="Name"
        onChange={setName}
        onFocus={() => setActiveField("name")}
        onKeyDown={(e) => handleSingleLineKey("name", e)}
        value={name}
      />
      <EditableField
        active={triggerActive}
        inputRef={triggerRef}
        label="Trigger (optional)"
        onChange={setTrigger}
        onFocus={() => setActiveField("trigger")}
        onKeyDown={(e) => handleSingleLineKey("trigger", e)}
        value={trigger}
      />
      <EditableTextarea
        active={contentActive}
        inputRef={contentRef}
        label="Content"
        onChange={setContent}
        onFocus={() => setActiveField("content")}
        onKeyDown={handleContentKey}
        value={content}
      />

      <Footer text="Tab switch field · ⌘/Ctrl+Enter save · Esc cancel" />
    </div>
  );
}

function EditableField({
  active,
  inputRef,
  label,
  onChange,
  onFocus,
  onKeyDown,
  value,
}: {
  active: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span style={{ color: active ? theme.primary : theme.textMuted }}>{label}</span>
      <input
        ref={inputRef}
        className="rounded px-2 py-1 outline-none"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        style={{
          backgroundColor: theme.backgroundElement,
          border: `1px solid ${active ? theme.primary : "transparent"}`,
          color: theme.text,
        }}
        type="text"
        value={value}
      />
    </div>
  );
}

function EditableTextarea({
  active,
  inputRef,
  label,
  onChange,
  onFocus,
  onKeyDown,
  value,
}: {
  active: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  label: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span style={{ color: active ? theme.primary : theme.textMuted }}>{label}</span>
      <textarea
        ref={inputRef}
        className="min-h-[6rem] rounded px-2 py-1 font-mono outline-none"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        rows={6}
        style={{
          backgroundColor: theme.backgroundElement,
          border: `1px solid ${active ? theme.primary : "transparent"}`,
          color: theme.text,
        }}
        value={value}
      />
    </div>
  );
}
