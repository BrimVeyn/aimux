import type { SplitDirection } from "@/lib/types";

// aimux 'vertical' split = side-by-side = react-resizable-panels 'horizontal';
// aimux 'horizontal' split = stacked = react-resizable-panels 'vertical'.
export function aimuxToRrpDirection(direction: SplitDirection): "horizontal" | "vertical" {
  return direction === "vertical" ? "horizontal" : "vertical";
}
