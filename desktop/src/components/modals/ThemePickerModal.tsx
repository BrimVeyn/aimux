import { THEME_IDS, type ThemeId } from "@aimux-config/tui/registry";

import { Empty, FilterField, Footer, Row } from "@/components/ModalHost";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ModalProjection } from "@/lib/types";

function themeDisplayName(id: string): string {
  return id
    .split(/[-_]/)
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(" ");
}
function filterThemeIds(filter: string | null): ThemeId[] {
  if (filter === null || filter === "") return THEME_IDS;
  const needle = filter.toLowerCase();
  return THEME_IDS.filter(
    (id) =>
      id.toLowerCase().includes(needle) ||
      themeDisplayName(id).toLowerCase().includes(needle),
  );
}

export function ThemePickerModal({
  modal,
  themeId,
}: {
  modal: ModalProjection;
  themeId: string;
}) {
  const options = filterThemeIds(modal.editBuffer);
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Theme</div>
      <FilterField value={modal.editBuffer} />
      <ScrollArea className="max-h-72">
        <div className="flex flex-col">
          {options.map((id, index) => (
            <Row
              key={id}
              selected={index === modal.selectedIndex}
              label={id === themeId ? `${themeDisplayName(id)} (current)` : themeDisplayName(id)}
            />
          ))}
          {options.length === 0 ? <Empty /> : null}
        </div>
      </ScrollArea>
      <Footer text="↑/↓ preview · Enter apply · Esc restore" />
    </div>
  );
}
