"use client";

import { Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { SUBSCRIPTIONS_SKELETON_TEST_ID } from "@/frontend/views/student/subscriptions/subscriptionsViewIds";

/**
 * SubscriptionsSkeleton — the loading branch: skeleton card rows matching
 * the final subscription card geometry. The region announces itself
 * politely through `component="output"` + `aria-busy` (the MUI v9
 * aria-live pattern).
 */
export function SubscriptionsSkeleton(): ReactNode {
  return (
    <Stack component="output" data-testid={SUBSCRIPTIONS_SKELETON_TEST_ID} aria-busy="true" sx={{ gap: 2 }}>
      {Array.from({ length: 2 }).map((_, index) => (
        <SubscriptionSkeletonCard key={`skeleton-row-${String(index)}`} />
      ))}
    </Stack>
  );
}

/** One skeleton card mirroring the final subscription card geometry. */
function SubscriptionSkeletonCard(): ReactNode {
  return (
    <Stack
      sx={theme => ({
        gap: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: theme.palette.divider,
        p: 2.5,
      })}
    >
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Skeleton variant="text" width="45%" height={28} />
        <Skeleton variant="rounded" width={96} height={26} />
      </Stack>
      <Skeleton variant="text" width="30%" height={20} />
      <Skeleton variant="text" width="30%" height={20} />
    </Stack>
  );
}
