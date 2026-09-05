import { Box } from "@mui/material";
import type { ReactNode } from "react";

/** Islamic banner above footer — shine gradient accent. */
export function FooterBanner(): ReactNode {
  return (
    <Box
      aria-hidden
      sx={{
        height: 4,
        background:
          "linear-gradient(90deg, var(--mui-palette-secondary-dark), var(--mui-palette-secondary-main), var(--mui-palette-secondary-light), var(--mui-palette-secondary-main), var(--mui-palette-secondary-dark))",
        backgroundSize: "200% 100%",
        animation: "footerBannerShine 6s linear infinite",
        "@keyframes footerBannerShine": {
          "0%": { backgroundPosition: "200% center" },
          "100%": { backgroundPosition: "-200% center" },
        },
      }}
    />
  );
}
