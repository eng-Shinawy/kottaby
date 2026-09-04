import { Button } from "@mui/material";
import type { ReactNode } from "react";

/** Single desktop top-nav link with the active-anchor copper underline. */
export function DesktopNavLink({
  href,
  label,
  isActive,
}: Readonly<{ href: string; label: string; isActive: boolean }>): ReactNode {
  return (
    <Button
      component="a"
      href={href}
      size="small"
      sx={{
        minWidth: "auto",
        px: 0.25,
        // Compact padding but a 44px floor: WCAG 2.5.5 touch-target minimum.
        py: 0.5,
        minHeight: 44,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "none",
        whiteSpace: "nowrap",
        ...(isActive
          ? {
              color: "var(--mui-palette-secondary-light)",
              position: "relative",
              "&::after": {
                content: '""',
                position: "absolute",
                bottom: -2,
                left: "10%",
                width: "80%",
                height: 2,
                bgcolor: "var(--mui-palette-secondary-main)",
                borderRadius: 1,
                transition: "all 0.2s ease",
              },
            }
          : {
              color: "var(--mui-palette-onPrimary)",
              opacity: 0.7,
            }),
        "&:hover": { opacity: 1 },
        transition: "color 0.2s ease, opacity 0.2s ease",
      }}
    >
      {label}
    </Button>
  );
}
