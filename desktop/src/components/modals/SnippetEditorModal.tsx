import { Footer } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
import type { ModalProjection } from "@/lib/types";

export function SnippetEditorModal({ modal }: { modal: ModalProjection }) {
  const isEditing = modal.sessionTargetId != null;
  const nameActive = modal.activeField === "name";
  const triggerActive = modal.activeField === "trigger";
  const contentActive = modal.activeField === "content";

  const name = nameActive ? (modal.editBuffer ?? "") : (modal.nameBuffer ?? "");
  const trigger = triggerActive ? (modal.editBuffer ?? "") : (modal.triggerBuffer ?? "");
  const content = contentActive ? (modal.editBuffer ?? "") : (modal.contentBuffer ?? "");

  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">{isEditing ? "Edit snippet" : "Create snippet"}</div>

      <Field active={nameActive} label="Name" value={name} />
      <Field active={triggerActive} label="Trigger (optional)" value={trigger} />
      <Field active={contentActive} label="Content" value={content} multiline />

      <Footer text="Tab switch field · Enter save · Esc cancel" />
    </div>
  );
}

function Field({
  active,
  label,
  value,
  multiline,
}: {
  active: boolean;
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span style={{ color: active ? theme.primary : theme.textMuted }}>{label}</span>
      <div
        className={multiline === true ? "rounded px-2 py-1 whitespace-pre-wrap" : "rounded px-2 py-1"}
        style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
      >
        {value}
        {active ? <span style={{ color: theme.primary }}>▏</span> : null}
      </div>
    </div>
  );
}
