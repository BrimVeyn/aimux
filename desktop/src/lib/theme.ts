// GUI chrome palette, backed by the live --aimux-<token> CSS variables set by
// useTheme. Same keys as before so components don't change. Tokens verified
// against packages/aimux-config/src/tui/tokens.ts.
export const theme = {
  background: "var(--aimux-background)",
  backgroundPanel: "var(--aimux-backgroundPanel)",
  backgroundElement: "var(--aimux-backgroundElement)",
  text: "var(--aimux-text)",
  textMuted: "var(--aimux-textMuted)",
  border: "var(--aimux-border)",
  primary: "var(--aimux-primary)",
  success: "var(--aimux-success)",
  warning: "var(--aimux-warning)",
  error: "var(--aimux-error)",
} as const;
