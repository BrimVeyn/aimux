import { Empty, FilterField, Footer, Row } from "@/components/ModalHost";
import type { ModalProjection, SnippetRecordLite } from "@/lib/types";

// Mirrors aimux filterSnippets (name OR content substring match).
function filterSnippets(
  snippets: SnippetRecordLite[],
  filter: string | null,
): SnippetRecordLite[] {
  if (filter === null || filter === "") return snippets;
  const lower = filter.toLowerCase();
  return snippets.filter(
    (s) => s.name.toLowerCase().includes(lower) || s.content.toLowerCase().includes(lower),
  );
}

export function SnippetPickerModal({
  modal,
  snippets,
  onSelect,
  onConfirm,
}: {
  modal: ModalProjection;
  snippets: SnippetRecordLite[];
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
}) {
  const options = filterSnippets(snippets, modal.editBuffer);
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Insert snippet</div>
      <FilterField value={modal.editBuffer} />
      <div className="flex flex-col">
        {options.map((s, index) => (
          <Row
            key={s.id}
            selected={index === modal.selectedIndex}
            label={s.name}
            hint={s.content.replace(/\s+/g, " ").slice(0, 40)}
            onSelect={() => onSelect(index)}
            onConfirm={() => onConfirm(index)}
          />
        ))}
        {options.length === 0 ? <Empty /> : null}
      </div>
      <Footer text="↑/↓ select · Enter insert · Esc cancel" />
    </div>
  );
}
