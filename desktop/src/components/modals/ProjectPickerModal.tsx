import { FilterField, Footer, Row } from "@/components/ModalHost";
import type { ModalProjection, ProjectRecordLite } from "@/lib/types";

// Mirrors aimux filterSessions (name OR projectPath substring match).
function filterSessions(
  projects: ProjectRecordLite[],
  filter: string | null,
): ProjectRecordLite[] {
  if (filter === null || filter === "") return projects;
  const lower = filter.toLowerCase();
  return projects.filter(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      (s.projectPath !== undefined && s.projectPath.toLowerCase().includes(lower)),
  );
}

export function ProjectPickerModal({
  modal,
  projects,
  currentProjectId,
  onSelect,
  onConfirm,
}: {
  modal: ModalProjection;
  projects: ProjectRecordLite[];
  currentProjectId: string | null;
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
}) {
  const options = filterSessions(projects, modal.editBuffer);
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Switch workspace</div>
      <FilterField value={modal.editBuffer} />
      <div className="flex flex-col">
        {options.map((s, index) => (
          <Row
            key={s.id}
            selected={index === modal.selectedIndex}
            label={s.id === currentProjectId ? `${s.name} (current)` : s.name}
            hint={s.projectPath}
            onSelect={() => onSelect(index)}
            onConfirm={() => onConfirm(index)}
          />
        ))}
        <Row
          key="__create-new__"
          selected={modal.selectedIndex === options.length}
          label="Create new workspace"
          onSelect={() => onSelect(options.length)}
          onConfirm={() => onConfirm(options.length)}
        />
      </div>
      <Footer text="↑/↓ select · Enter open/create · Esc cancel" />
    </div>
  );
}
