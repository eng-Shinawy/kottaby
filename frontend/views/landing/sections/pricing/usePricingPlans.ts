"use client";

import { useMemo } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Localized pricing tiers resolved for the current yearly/monthly period. */
export function usePricingPlans(yearly: boolean) {
  const t = useAppTranslation(Landing);

  return useMemo(
    () => [
      {
        name: t.pricingPlanFreeName,
        price: t.pricingPlanFreePrice,
        priceNote: yearly ? t.pricingPlanFreePriceNoteYearly : t.pricingPlanFreePriceNote,
        features: [t.pricingPlanFreeF1, t.pricingPlanFreeF2, t.pricingPlanFreeF3, t.pricingPlanFreeF4],
        cta: t.pricingPlanFreeCta,
        popular: false,
      },
      {
        name: t.pricingPlanProName,
        price: yearly ? t.pricingPlanProPriceYearly : t.pricingPlanProPrice,
        priceNote: yearly ? t.pricingPlanProPriceNoteYearly : t.pricingPlanProPriceNote,
        features: [t.pricingPlanProF1, t.pricingPlanProF2, t.pricingPlanProF3, t.pricingPlanProF4, t.pricingPlanProF5],
        cta: t.pricingPlanProCta,
        popular: true,
      },
      {
        name: t.pricingPlanFamilyName,
        price: yearly ? t.pricingPlanFamilyPriceYearly : t.pricingPlanFamilyPrice,
        priceNote: yearly ? t.pricingPlanFamilyPriceNoteYearly : t.pricingPlanFamilyPriceNote,
        features: [
          t.pricingPlanFamilyF1,
          t.pricingPlanFamilyF2,
          t.pricingPlanFamilyF3,
          t.pricingPlanFamilyF4,
          t.pricingPlanFamilyF5,
          t.pricingPlanFamilyF6,
        ],
        cta: t.pricingPlanFamilyCta,
        popular: false,
      },
    ],
    [
      yearly,
      t.pricingPlanFreeName,
      t.pricingPlanFreePrice,
      t.pricingPlanFreePriceNote,
      t.pricingPlanFreePriceNoteYearly,
      t.pricingPlanFreeF1,
      t.pricingPlanFreeF2,
      t.pricingPlanFreeF3,
      t.pricingPlanFreeF4,
      t.pricingPlanFreeCta,
      t.pricingPlanProName,
      t.pricingPlanProPrice,
      t.pricingPlanProPriceYearly,
      t.pricingPlanProPriceNote,
      t.pricingPlanProPriceNoteYearly,
      t.pricingPlanProF1,
      t.pricingPlanProF2,
      t.pricingPlanProF3,
      t.pricingPlanProF4,
      t.pricingPlanProF5,
      t.pricingPlanProCta,
      t.pricingPlanFamilyName,
      t.pricingPlanFamilyPrice,
      t.pricingPlanFamilyPriceYearly,
      t.pricingPlanFamilyPriceNote,
      t.pricingPlanFamilyPriceNoteYearly,
      t.pricingPlanFamilyF1,
      t.pricingPlanFamilyF2,
      t.pricingPlanFamilyF3,
      t.pricingPlanFamilyF4,
      t.pricingPlanFamilyF5,
      t.pricingPlanFamilyF6,
      t.pricingPlanFamilyCta,
    ]
  );
}
