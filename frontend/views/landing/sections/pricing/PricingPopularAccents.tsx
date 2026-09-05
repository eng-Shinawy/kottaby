import { Box } from "@mui/material";
import type { ReactNode } from "react";

interface Props {
  readonly popular: boolean;
  readonly popularLabel: string;
}

/** Shimmer sweep + "popular" pill on the featured pricing plan. */
export function PricingPopularAccents({ popular, popularLabel }: Props): ReactNode {
  return (
    <>
      {/* Shimmer effect for popular plan */}
      {popular ? (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 0,
            left: "-100%",
            width: "100%",
            height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(184,115,51,0.06), transparent)",
            animation: "pricingShimmer 3s ease-in-out infinite",
            pointerEvents: "none",
            "@keyframes pricingShimmer": {
              "0%": { left: "-100%" },
              "100%": { left: "100%" },
            },
          }}
        />
      ) : null}

      {popular ? (
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            top: -12,
            insetInlineStart: "50%",
            transform: "translateX(-50%)",
            px: 2,
            py: 0.5,
            borderRadius: 99,
            bgcolor: "var(--mui-palette-secondary-main)",
            color: "var(--mui-palette-onSecondary)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {popularLabel}
        </Box>
      ) : null}
    </>
  );
}
