// GUI chrome palette, backed by the live --aimux-<token> CSS variables set by
// useTheme. Same keys as before so components don't change. Tokens verified
// against packages/aimux-config/src/tui/tokens.ts.
export const theme = {
  accent: "var(--aimux-accent)",
  background: "var(--aimux-background)",
  backgroundElement: "var(--aimux-backgroundElement)",
  backgroundPanel: "var(--aimux-backgroundPanel)",
  border: "var(--aimux-border)",
  diffAdded: "var(--aimux-diffAdded)",
  diffRemoved: "var(--aimux-diffRemoved)",
  error: "var(--aimux-error)",
  primary: "var(--aimux-primary)",
  secondary: "var(--aimux-secondary)",
  success: "var(--aimux-success)",
  text: "var(--aimux-text)",
  textMuted: "var(--aimux-textMuted)",
  warning: "var(--aimux-warning)",
} as const;
