import { Footer } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
import type { ModalProjection } from "@/lib/types";

export function TextFieldModal({
  modal,
  title,
}: {
  modal: ModalProjection;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">{title}</div>
      <div
        className="rounded px-2 py-1"
        style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
      >
        {modal.editBuffer ?? ""}
        <span style={{ color: theme.primary }}>▏</span>
      </div>
      <Footer text="Enter confirm · Esc cancel" />
    </div>
  );
}
