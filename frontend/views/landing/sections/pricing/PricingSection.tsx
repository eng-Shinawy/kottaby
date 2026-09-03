"use client";

import { Box } from "@mui/material";
import { type ReactNode, useState } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { PricingPeriodToggle } from "@/frontend/views/landing/sections/pricing/PricingPeriodToggle";
import { PricingPlanCard } from "@/frontend/views/landing/sections/pricing/PricingPlanCard";
import { usePricingPlans } from "@/frontend/views/landing/sections/pricing/usePricingPlans";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Pricing section ────────────────────────────────────────────────

export function PricingSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const [yearly, setYearly] = useState(false);
  const plans = usePricingPlans(yearly);

  return (
    <SectionWrapper badge={t.pricingBadge} title={t.pricingTitle} subtitle={t.pricingSubtitle} bg="default">
      <PricingPeriodToggle yearly={yearly} onYearlyChange={setYearly} />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
          gap: 3,
          alignItems: "start",
        }}
      >
        {plans.map(plan => (
          <PricingPlanCard key={plan.name} plan={plan} />
        ))}
      </Box>
    </SectionWrapper>
  );
}
