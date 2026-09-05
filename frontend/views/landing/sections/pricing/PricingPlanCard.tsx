import { CheckCircleOutlined as CheckIcon } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { PricingPopularAccents } from "@/frontend/views/landing/sections/pricing/PricingPopularAccents";
import { POPULAR_CARD_SX, POPULAR_CTA_SX, STANDARD_CARD_SX, STANDARD_CTA_SX } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Canonical shape of a pricing tier after yearly/monthly resolution. */
export interface PricingPlanView {
  readonly name: string;
  readonly price: string;
  readonly priceNote: string;
  readonly features: readonly string[];
  readonly cta: string;
  readonly popular: boolean;
}

/**
 * One pricing tier card — extracted so PricingSection stays under the
 * sonarjs cognitive-complexity ceiling (the per-plan ternary tree lives
 * here at depth 1). Translations resolve via the shared Landing handle.
 */
export function PricingPlanCard({ plan }: Readonly<{ plan: PricingPlanView }>): ReactNode {
  const t = useAppTranslation(Landing);
  const popular = plan.popular;

  return (
    <Stack spacing={3} sx={popular ? POPULAR_CARD_SX : STANDARD_CARD_SX}>
      <PricingPopularAccents popular={popular} popularLabel={t.pricingPlanProPopular} />

      <Typography
        variant="h6"
        sx={{
          position: "relative",
          zIndex: 1,
          fontWeight: 700,
          fontSize: 20,
          color: popular ? "var(--mui-palette-secondary-main)" : "var(--mui-palette-text-primary)",
        }}
      >
        {plan.name}
      </Typography>

      <Box sx={{ position: "relative", zIndex: 1 }}>
        <Typography
          sx={{
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1,
            color: popular ? "var(--mui-palette-secondary-main)" : "var(--mui-palette-text-primary)",
            letterSpacing: "-0.03em",
          }}
        >
          {plan.price}
          {plan.price !== t.pricingPlanFreePrice && (
            <Box component="span" sx={{ fontSize: 18, fontWeight: 500, opacity: 0.7 }}>
              {t.pricingMonthly}
            </Box>
          )}
        </Typography>
        <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)", mt: 0.5 }}>
          {plan.priceNote}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, position: "relative", zIndex: 1 }}>
        {plan.features.map(feat => (
          <Stack key={feat} direction="row" spacing={1.5} sx={{ py: 0.75 }}>
            <CheckIcon
              sx={{
                fontSize: 18,
                color: "var(--mui-palette-secondary-main)",
                flexShrink: 0,
                mt: 0.25,
              }}
            />
            <Typography variant="body2" sx={{ lineHeight: 1.5, color: "var(--mui-palette-text-secondary)" }}>
              {feat}
            </Typography>
          </Stack>
        ))}
      </Box>

      <Button
        component={Link}
        href="/register"
        variant={popular ? "contained" : "outlined"}
        fullWidth
        sx={popular ? POPULAR_CTA_SX : STANDARD_CTA_SX}
      >
        {plan.cta}
      </Button>
    </Stack>
  );
}
