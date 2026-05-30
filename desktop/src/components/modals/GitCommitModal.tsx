import { Footer } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
import type { ModalProjection } from "@/lib/types";

export function GitCommitModal({
  modal,
  stagedCount,
}: {
  modal: ModalProjection;
  stagedCount: number;
}) {
  const titleActive = modal.activeField === "title";
  const bodyActive = modal.activeField === "body";
  const isConfirm = modal.stage === "confirm";

  const title = titleActive ? (modal.editBuffer ?? "") : (modal.contentBuffer ?? "");
  const body = bodyActive ? (modal.editBuffer ?? "") : (modal.contentBuffer ?? "");

  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Commit</div>

      {isConfirm ? (
        <div className="flex flex-col gap-0.5">
          {stagedCount > 0 ? (
            <span style={{ color: theme.warning }}>
              Commit will include the <strong>{stagedCount} staged file(s)</strong> only.
            </span>
          ) : (
            <span style={{ color: theme.warning }}>
              <strong>git add -A</strong> will stage every change before committing.
            </span>
          )}
          <span style={{ color: theme.textMuted }}>
            Enter to confirm · Esc to cancel · edits below still apply.
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <span style={{ color: titleActive ? theme.primary : theme.textMuted }}>Title</span>
        <div
          className="rounded px-2 py-1"
          style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
        >
          {title}
          {titleActive ? <span style={{ color: theme.primary }}>▏</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span style={{ color: bodyActive ? theme.primary : theme.textMuted }}>Body (optional)</span>
        <div
          className="rounded px-2 py-1"
          style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
        >
          {body}
          {bodyActive ? <span style={{ color: theme.primary }}>▏</span> : null}
        </div>
      </div>

      <Footer text="Tab switch field · Enter confirm · Esc cancel" />
    </div>
  );
}
