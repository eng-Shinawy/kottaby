import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Resource card footer: copper rule + read-more link. */
export function ResourceCardFooter(): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <>
      <Box
        aria-hidden
        sx={{ width: 32, height: 2, bgcolor: "var(--mui-palette-secondary-main)", borderRadius: 1, opacity: 0.4 }}
      />
      <Typography
        component="button"
        onClick={() => {}}
        sx={{
          color: "var(--mui-palette-secondary-main)",
          fontWeight: 700,
          fontSize: 14,
          textTransform: "none",
          p: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        {t.resourceReadMore}
      </Typography>
    </>
  );
}
