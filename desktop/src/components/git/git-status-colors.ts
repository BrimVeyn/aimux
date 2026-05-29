import { theme } from "@/lib/theme";

export type GitFileStatus = "?" | "A" | "C" | "D" | "M" | "R" | "U";

// Mirrors src/ui/components/git/git-panel.tsx :: statusColor (~line 54).
export function statusColor(status: GitFileStatus): string {
  switch (status) {
    case "?":
    case "C":
    case "R":
      return theme.text;
    case "A":
      return theme.diffAdded;
    case "D":
    case "U":
      return theme.diffRemoved;
    case "M":
      return theme.warning;
  }
}

// Untracked files always display the "A" glyph in the TUI (see displayStatus).
export function statusGlyph(status: GitFileStatus, isUntracked: boolean): string {
  return isUntracked ? "A" : status;
}
