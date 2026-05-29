import { type CSSProperties, type MouseEvent, type ReactNode, useState } from "react";

import { theme } from "@/lib/theme";

type ButtonVariant = "ghost" | "solid";
type ButtonTone = "element" | "panel";

interface AimuxButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
  style?: CSSProperties;
  title?: string;
  tone?: ButtonTone;
  variant?: ButtonVariant;
}

const solidBackground: Record<ButtonTone, string> = {
  element: theme.backgroundElement,
  panel: theme.backgroundPanel,
};

const solidHoverBackground: Record<ButtonTone, string> = {
  element: theme.border,
  panel: theme.backgroundElement,
};

export function AimuxButton({
  children,
  className = "",
  onClick,
  onMouseDown,
  style,
  title,
  tone = "element",
  variant = "solid",
}: AimuxButtonProps) {
  const [hovered, setHovered] = useState(false);
  const solid = variant === "solid";
  const backgroundColor = solid
    ? hovered
      ? solidHoverBackground[tone]
      : solidBackground[tone]
    : "transparent";
  const color = solid ? theme.text : hovered ? theme.text : theme.textMuted;
  return (
    <button
      className={`cursor-pointer rounded transition-colors ${className}`}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ backgroundColor, color, ...style }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
