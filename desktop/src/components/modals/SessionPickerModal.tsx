import { Empty, FilterField, Footer, Row } from "@/components/ModalHost";
import type { ModalProjection, SessionRecordLite } from "@/lib/types";

// Mirrors aimux filterSessions (name OR projectPath substring match).
function filterSessions(
  sessions: SessionRecordLite[],
  filter: string | null,
): SessionRecordLite[] {
  if (filter === null || filter === "") return sessions;
  const lower = filter.toLowerCase();
  return sessions.filter(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      (s.projectPath !== undefined && s.projectPath.toLowerCase().includes(lower)),
  );
}

export function SessionPickerModal({
  modal,
  sessions,
  currentSessionId,
}: {
  modal: ModalProjection;
  sessions: SessionRecordLite[];
  currentSessionId: string | null;
}) {
  const options = filterSessions(sessions, modal.editBuffer);
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Switch workspace</div>
      <FilterField value={modal.editBuffer} />
      <div className="flex flex-col">
        {options.map((s, index) => (
          <Row
            key={s.id}
            selected={index === modal.selectedIndex}
            label={s.id === currentSessionId ? `${s.name} (current)` : s.name}
            hint={s.projectPath}
          />
        ))}
        {options.length === 0 ? <Empty /> : null}
      </div>
      <Footer text="↑/↓ select · Enter switch · C-n new · Esc cancel" />
    </div>
  );
}
