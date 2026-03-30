import { registerMode } from "../registry";
import { modalCreateSessionMode } from "./modal-create-session";
import { modalHelpMode } from "./modal-help";
import { modalNewTabMode } from "./modal-new-tab";
import { modalNewTabCommandEditMode } from "./modal-new-tab-command-edit";
import { modalRenameTabMode } from "./modal-rename-tab";
import { modalSessionNameMode } from "./modal-session-name";
import { modalSessionPickerMode } from "./modal-session-picker";
import { modalSessionPickerFilterMode } from "./modal-session-picker-filter";
import { modalSnippetEditorMode } from "./modal-snippet-editor";
import { modalSnippetPickerMode } from "./modal-snippet-picker";
import { modalSnippetPickerFilterMode } from "./modal-snippet-picker-filter";
import { modalThemePickerMode } from "./modal-theme-picker";
import { navigationMode } from "./navigation";
import { terminalInputMode } from "./terminal-input";

export function registerAllModes(): void {
  registerMode(navigationMode);
  registerMode(terminalInputMode);
  registerMode(modalHelpMode);
  registerMode(modalThemePickerMode);
  registerMode(modalRenameTabMode);
  registerMode(modalNewTabMode);
  registerMode(modalNewTabCommandEditMode);
  registerMode(modalSessionPickerMode);
  registerMode(modalSessionPickerFilterMode);
  registerMode(modalSessionNameMode);
  registerMode(modalCreateSessionMode);
  registerMode(modalSnippetPickerMode);
  registerMode(modalSnippetPickerFilterMode);
  registerMode(modalSnippetEditorMode);
}
