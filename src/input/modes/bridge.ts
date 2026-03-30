import type { AppState } from "../../state/types";
import type { ModeId } from "./types";

export function deriveModeId(state: AppState): ModeId {
  if (state.focusMode === "navigation") return "navigation";
  if (state.focusMode === "terminal-input") return "terminal-input";

  if (state.focusMode === "command-edit") {
    switch (state.modal.type) {
      case "new-tab":
        return "modal.new-tab.command-edit";
      case "session-picker":
        return "modal.session-picker.filtering";
      case "session-name":
        return "modal.session-name";
      case "create-session":
        return "modal.create-session";
      case "rename-tab":
        return "modal.rename-tab";
      case "snippet-picker":
        return "modal.snippet-picker.filtering";
      case "snippet-editor":
        return "modal.snippet-editor";
      default:
        return "navigation";
    }
  }

  if (state.focusMode === "modal") {
    switch (state.modal.type) {
      case "new-tab":
        return "modal.new-tab";
      case "session-picker":
        return "modal.session-picker";
      case "theme-picker":
        return "modal.theme-picker";
      case "help":
        return "modal.help";
      case "snippet-picker":
        return "modal.snippet-picker";
      default:
        return "navigation";
    }
  }

  return "navigation";
}
