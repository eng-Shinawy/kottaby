import { Box, Button, Chip, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Monthly/yearly billing period switch (discount chip + segmented buttons). */
export function PricingPeriodToggle({
  yearly,
  onYearlyChange,
}: Readonly<{ yearly: boolean; onYearlyChange: (yearly: boolean) => void }>): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        justifyContent: "center",
        mb: 4,
      }}
    >
      <Chip
        label={t.pricingYearlyDiscount}
        size="small"
        sx={{
          bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 12%, transparent)",
          color: "var(--mui-palette-secondary-main)",
          fontWeight: 600,
          fontSize: 12,
        }}
      />
      <Box
        sx={{
          display: "flex",
          borderRadius: 99,
          border: "1px solid var(--mui-palette-divider)",
          p: 0.25,
        }}
      >
        <Button
          size="small"
          onClick={() => onYearlyChange(false)}
          sx={{
            borderRadius: 99,
            px: 2,
            py: 0.5,
            fontWeight: 600,
            textTransform: "none",
            fontSize: 14,
            bgcolor: !yearly ? "var(--mui-palette-secondary-main)" : "transparent",
            color: !yearly ? "var(--mui-palette-onSecondary)" : "var(--mui-palette-text-secondary)",
            transition: "all 0.25s ease",
            "&:hover": {
              bgcolor: !yearly
                ? "var(--mui-palette-secondary-dark)"
                : "color-mix(in srgb, var(--mui-palette-secondary-main) 10%, transparent)",
            },
          }}
        >
          {t.pricingToggleMonthly}
        </Button>
        <Button
          size="small"
          onClick={() => onYearlyChange(true)}
          sx={{
            borderRadius: 99,
            px: 2,
            py: 0.5,
            fontWeight: 600,
            textTransform: "none",
            fontSize: 14,
            bgcolor: yearly ? "var(--mui-palette-secondary-main)" : "transparent",
            color: yearly ? "var(--mui-palette-onSecondary)" : "var(--mui-palette-text-secondary)",
            transition: "all 0.25s ease",
            "&:hover": {
              bgcolor: yearly
                ? "var(--mui-palette-secondary-dark)"
                : "color-mix(in srgb, var(--mui-palette-secondary-main) 10%, transparent)",
            },
          }}
        >
          {t.pricingToggleYearly}
        </Button>
      </Box>
    </Stack>
  );
}
