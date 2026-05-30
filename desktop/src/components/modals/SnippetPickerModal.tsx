import { Empty, FilterField, Footer, Row } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
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
  onOpenEditor,
}: {
  modal: ModalProjection;
  snippets: SnippetRecordLite[];
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
  onOpenEditor: (snippetId?: string) => void;
}) {
  const options = filterSnippets(snippets, modal.editBuffer);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-bold">Insert snippet</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-xs"
          style={{ backgroundColor: theme.backgroundElement, color: theme.primary }}
          onClick={() => onOpenEditor()}
        >
          + new snippet
        </button>
      </div>
      <FilterField value={modal.editBuffer} />
      <div className="flex flex-col">
        {options.map((s, index) => (
          <div key={s.id} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <Row
                selected={index === modal.selectedIndex}
                label={s.name}
                hint={s.content.replace(/\s+/g, " ").slice(0, 40)}
                onSelect={() => onSelect(index)}
                onConfirm={() => onConfirm(index)}
              />
            </div>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-xs"
              style={{ color: theme.textMuted }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenEditor(s.id);
              }}
              title="Edit snippet"
            >
              edit
            </button>
          </div>
        ))}
        {options.length === 0 ? <Empty /> : null}
      </div>
      <Footer text="↑/↓ select · Enter insert · Esc cancel" />
    </div>
  );
}
