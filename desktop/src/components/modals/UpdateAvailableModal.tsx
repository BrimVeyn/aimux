import { Footer, Row } from "@/components/ModalHost";
import { theme } from "@/lib/theme";
import type { ModalProjection } from "@/lib/types";

const OPTIONS = ["Yes, update now", "No, skip this version"] as const;

export function UpdateAvailableModal({
  modal,
  onSelect,
  onConfirm,
}: {
  modal: ModalProjection;
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">Update available</div>
      <div style={{ color: theme.textMuted }}>
        {modal.currentVersion ?? "?"} → {modal.latestVersion ?? "?"}
      </div>
      <div className="flex flex-col">
        {OPTIONS.map((label, index) => (
          <Row
            key={label}
            selected={index === modal.selectedIndex}
            label={label}
            onSelect={() => onSelect(index)}
            onConfirm={() => onConfirm(index)}
          />
        ))}
      </div>
      <Footer text="↑/↓ select · Enter confirm · Esc cancel" />
    </div>
  );
}
