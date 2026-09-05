import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Visually-hidden skip-to-content anchor (a11y). */
export function SkipToContentLink(): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <Box
      component="a"
      href="#main-content"
      sx={{
        position: "fixed",
        top: 8,
        insetInlineStart: 8,
        zIndex: 2000,
        px: 2,
        py: 1,
        borderRadius: 1.5,
        bgcolor: "var(--mui-palette-secondary-main)",
        color: "var(--mui-palette-onSecondary)",
        fontWeight: 700,
        fontSize: 14,
        textDecoration: "none",
        boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
        transform: "translateY(-200%)",
        transition: "transform 0.2s ease",
        "&:focus-visible": { transform: "translateY(0)" },
      }}
    >
      {t.a11ySkipToContent}
    </Box>
  );
}
