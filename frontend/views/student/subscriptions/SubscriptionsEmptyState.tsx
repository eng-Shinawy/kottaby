"use client";

import CardMembershipOutlined from "@mui/icons-material/CardMembershipOutlined";
import { Button, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { STUDENT_PLANS_ROUTE } from "@/frontend/views/student/checkout/result/resultRoutes";
import { SUBSCRIPTIONS_EMPTY_TEST_ID } from "@/frontend/views/student/subscriptions/subscriptionsViewIds";
import { useAppTranslation } from "@/shared/locale/client";
import { Checkout } from "@/shared/locale/namespaces/checkout";

/**
 * SubscriptionsEmptyState — the empty-list state: the localized empty
 * title + body copy and the browse-plans CTA (the prototype's centered
 * illustration rhythm). The CTA navigates to the plan catalog — the
 * funnel's entry point for a student with no subscriptions yet.
 */
export function SubscriptionsEmptyState(): ReactNode {
  const t = useAppTranslation(Checkout);
  const router = useRouter();

  return (
    <Stack
      data-testid={SUBSCRIPTIONS_EMPTY_TEST_ID}
      sx={{ alignItems: "center", gap: 2, py: { xs: 8, sm: 12 }, textAlign: "center" }}
    >
      <Typography
        aria-hidden
        component="span"
        sx={theme => ({
          width: 72,
          height: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          bgcolor: theme.palette.secondaryContainer,
          color: theme.palette.onSecondaryContainer,
        })}
      >
        <CardMembershipOutlined sx={{ fontSize: 36 }} />
      </Typography>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        {t.subscriptionsEmptyTitle}
      </Typography>
      <Typography
        variant="body2"
        sx={theme => ({
          color: theme.palette.text.secondary,
          maxWidth: 420,
          textAlign: "center",
          textWrap: "balance",
        })}
      >
        {t.subscriptionsEmptyBody}
      </Typography>
      <Button
        variant="contained"
        color="secondary"
        onClick={() => router.push(STUDENT_PLANS_ROUTE)}
        sx={{ minHeight: 44, px: 4, borderRadius: 999, width: { xs: "100%", sm: "auto" } }}
      >
        {t.browsePlansButton}
      </Button>
    </Stack>
  );
}
