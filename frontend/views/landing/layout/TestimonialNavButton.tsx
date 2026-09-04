import { KeyboardArrowLeft, KeyboardArrowRight } from "@mui/icons-material";
import { IconButton } from "@mui/material";
import type { ReactNode } from "react";

/** Circular prev/next arrow for the testimonials carousel. */
export function TestimonialNavButton({
  side,
  label,
  disabled,
  onClick,
}: Readonly<{
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
}>): ReactNode {
  return (
    <IconButton
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      sx={{
        position: "absolute",
        top: "50%",
        [side]: { xs: -8, md: -48 },
        transform: "translateY(-50%)",
        zIndex: 2,
        // 44px touch-target floor (WCAG 2.5.5) for the carousel arrows.
        width: 44,
        height: 44,
        border: "2px solid var(--mui-palette-secondary-main)",
        borderRadius: "50%",
        color: "var(--mui-palette-secondary-main)",
        "&:hover": {
          bgcolor: "var(--mui-palette-secondary-main)",
          color: "var(--mui-palette-onSecondary)",
        },
        "&:disabled": {
          opacity: 0.3,
          borderColor: "var(--mui-palette-divider)",
          color: "var(--mui-palette-text-disabled)",
        },
      }}
    >
      {side === "left" ? <KeyboardArrowLeft /> : <KeyboardArrowRight />}
    </IconButton>
  );
}
