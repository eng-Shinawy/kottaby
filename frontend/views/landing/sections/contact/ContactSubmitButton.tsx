import { Button } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Contact form submit button with shimmer sweep. */
export function ContactSubmitButton(): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <Button
      type="submit"
      variant="contained"
      size="large"
      sx={{
        position: "relative",
        overflow: "hidden",
        bgcolor: "var(--mui-palette-secondary-main)",
        color: "var(--mui-palette-onSecondary)",
        fontWeight: 700,
        textTransform: "none",
        borderRadius: 2,
        px: 4,
        py: 1.2,
        // Tap floor — the padding-only height measured 41px in visual QA.
        minHeight: 44,
        "&::after": {
          content: '""',
          position: "absolute",
          top: 0,
          left: "-100%",
          width: "100%",
          height: "100%",
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
          transition: "left 0.5s ease",
        },
        "&:hover": {
          bgcolor: "var(--mui-palette-secondary-dark)",
          "&::after": { left: "100%" },
        },
      }}
    >
      {t.contactButton}
    </Button>
  );
}
