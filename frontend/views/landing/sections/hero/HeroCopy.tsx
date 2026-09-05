import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Headline with gradient accent word + subtitle. */
export function HeroCopy(): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <>
      <Typography
        variant="h1"
        sx={{
          fontSize: { xs: 36, md: 56 },
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: "-0.03em",
          m: 0,
        }}
      >
        {t.heroTitle}{" "}
        <Box
          component="span"
          sx={{
            background:
              "linear-gradient(135deg, var(--mui-palette-secondary-light) 0%, var(--mui-palette-secondary-main) 100%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          {t.heroTitleAccent}
        </Box>
      </Typography>

      {/* Subtitle */}
      <Typography
        variant="h6"
        component="p"
        sx={{ maxWidth: 580, lineHeight: 1.6, opacity: 0.85, fontWeight: 400, fontSize: { xs: 16, md: 18 } }}
      >
        {t.heroSubtitle}
      </Typography>
    </>
  );
}
