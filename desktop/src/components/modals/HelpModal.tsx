import { FilterField, Footer } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
import type { GuiHelpEntry, ModalProjection } from "@/lib/types";

function filterHelp(entries: GuiHelpEntry[], filter: string | null): GuiHelpEntry[] {
  if (filter === null || filter === "") return entries;
  const lower = filter.toLowerCase();
  return entries.filter(
    (e) =>
      e.description.toLowerCase().includes(lower) ||
      e.keysDisplay.toLowerCase().includes(lower) ||
      e.modeLabel.toLowerCase().includes(lower),
  );
}

export function HelpModal({
  modal,
  helpEntries,
}: {
  modal: ModalProjection;
  helpEntries: GuiHelpEntry[];
}) {
  const entries = filterHelp(helpEntries ?? [], modal.editBuffer);
  const groups = new Map<string, GuiHelpEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.modeLabel) ?? [];
    list.push(e);
    groups.set(e.modeLabel, list);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Keybindings</div>
      <FilterField value={modal.editBuffer} />
      <div className="flex flex-col gap-2">
        {[...groups.entries()].map(([label, list], groupIndex) => (
          <div key={label} className="flex flex-col">
            {groupIndex > 0 ? (
              <div className="mb-2 h-px" style={{ backgroundColor: theme.border }} />
            ) : null}
            <div className="px-2 py-0.5 font-semibold" style={{ color: theme.primary }}>
              {label}
            </div>
            {list.map((e) => (
              <div
                key={`${label}:${e.keys}:${e.description}`}
                className="flex items-center gap-2 px-2 py-0.5"
              >
                <span className="font-mono" style={{ color: theme.text }}>
                  {e.keysDisplay}
                </span>
                <span className="ml-auto truncate" style={{ color: theme.textMuted }}>
                  {e.description}
                </span>
              </div>
            ))}
          </div>
        ))}
        {entries.length === 0 ? (
          <div className="px-2 py-1" style={{ color: theme.textMuted }}>
            no match
          </div>
        ) : null}
      </div>
      <Footer text="type to filter · Esc close" />
    </div>
  );
}
