import { Empty, Footer, Row } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
import type { DirectoryResultLite, ModalProjection } from "@/lib/types";

export function CreateSessionModal({
  modal,
  directoryResults,
}: {
  modal: ModalProjection;
  directoryResults: DirectoryResultLite[];
}) {
  const dirActive = modal.activeField !== "name";
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">New workspace</div>
      <div className="flex flex-col gap-1">
        <span style={{ color: dirActive ? theme.primary : theme.textMuted }}>Directory</span>
        <div
          className="rounded px-2 py-1"
          style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
        >
          {dirActive ? (
            modal.editBuffer ?? ""
          ) : (
            <span style={{ color: theme.textMuted }}>{modal.editBuffer ?? "(search…)"}</span>
          )}
          {dirActive ? <span style={{ color: theme.primary }}>▏</span> : null}
        </div>
        <div className="flex max-h-40 flex-col overflow-y-auto">
          {directoryResults.map((r, index) => (
            <Row
              key={r.path}
              selected={dirActive && index === modal.selectedIndex}
              label={r.path}
              hint={r.type}
            />
          ))}
          {dirActive && directoryResults.length === 0 ? <Empty /> : null}
        </div>
        <span style={{ color: dirActive ? theme.textMuted : theme.primary }}>Name</span>
        <div
          className="rounded px-2 py-1"
          style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
        >
          {modal.nameBuffer ?? ""}
          {!dirActive ? <span style={{ color: theme.primary }}>▏</span> : null}
        </div>
      </div>
      <Footer text="Tab switch field · ↑/↓ select dir · Enter confirm · Esc cancel" />
    </div>
  );
}
