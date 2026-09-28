"use client";

/**
 * AdminCooldownLifecyclePanel — the admin dashboard's applicant-cooldown
 * LIFECYCLE panel: three tappable buckets (active → expiring soon →
 * expired) that deep-link into the user directory pre-filtered, so the
 * dashboard answers "who is cooling / who is about to exit cooling / who
 * is ready again" with ONE click to the exact working surface.
 *
 * Data discipline (mirrors the panel's wire contract):
 *  - Zero props, no client-side role gating — the page-level server guard
 *    (`withPageAuth`) stays the ONLY authorization boundary; the
 *    `adminApplicantCooldownStats` query is admin-scoped server-side.
 *  - The counts come from the SAME captured-now snapshot discipline the
 *    directory's lifecycle filter arms predicate against, and the
 *    expiring-soon bucket shares `COOLDOWN_EXPIRING_SOON_DAYS` with the
 *    directory's `cooldownExpiringSoon` narrow — the KPI and its
 *    deep-linked listing cannot disagree. The bucket label's window length
 *    arrives ON the wire (`expiringSoonWindowDays`) so the copy can never
 *    drift from the count.
 *  - Deep-links carry BOTH predicates where meaningful: the expiring-soon
 *    bucket links `?cooldown=active&expiring=1` (the state narrow keeps the
 *    rendered chips and the rows telling one story); active links
 *    `?cooldown=active`; expired links `?cooldown=expired`.
 *
 * Visual language (the cooldown-domain dot family, extended):
 *  - Each bucket leads with a tone-tinted STATUS DOT sitting ON a vertical
 *    rail — the same dot language the directory's cooldown chips and the
 *    detail-page timeline use, so the whole domain reads as one system.
 *  - Tone semantics: `warning` for active (directory-chip parity), `error`
 *    for the urgent expiring-soon slice (a deeper alarm inside the same
 *    lifecycle), `success` for expired (cooled off — re-evaluation can be
 *    granted again). The expiring-soon dot PULSES (reduced-motion gated),
 *    echoing the live-restriction pulse of the directory's active chip.
 *  - Rows: full-width tappable surfaces with hover lift (bg tint + primary
 *    border + chevron nudge — pure `sx` transitions), tabular-numeral
 *    counts that never jitter, and a dimmed (but still navigable) state
 *    for zero buckets — navigating to an empty bucket lands on the
 *    directory's filtered empty state with its one-click recovery CTA.
 *
 * State matrix: loading → skeleton card (`aria-busy`); UNAUTHORIZED /
 * FORBIDDEN → shared `PermissionDeniedFallback` (never bare null); any
 * other error → outlined Alert with the localized internal-error copy
 * (silent degradation — the errorLink owns toasts).
 *
 * MUI v9 discipline: `sx`-only styling, palette colors via theme callbacks,
 * `*Outlined` icons, RTL-safe logical composition (no physical margins —
 * flex/grid mirrors automatically), compile-time i18n handles only.
 *
 * Internals extracted for the file-size cap: `lifecycleBucketViews.ts`
 * (bucket view-model + directory URL contract), `LifecyclePanelRows.tsx`
 * (the tappable bucket rows), `LifecyclePanelChrome.tsx` (loading/error
 * shells, rail, and footer).
 */

import { useQuery } from "@apollo/client/react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { adminApplicantCooldownStatsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import {
  LifecycleFooter,
  LifecyclePanelError,
  LifecycleRail,
  PanelSkeleton,
} from "@/frontend/views/admin/dashboard/LifecyclePanelChrome";
import { buildBucketViews } from "@/frontend/views/admin/dashboard/lifecycleBucketViews";
import { Dashboard, useAppTranslation } from "@/shared/locale";

export function AdminCooldownLifecyclePanel(): ReactNode {
  const t = useAppTranslation(Dashboard);
  const router = useRouter();
  const { data, loading, error } = useQuery(adminApplicantCooldownStatsQueryDocument, {
    fetchPolicy: "cache-and-network",
  });

  // Branch 1 — in flight: skeleton card with busy semantics.
  if (loading && !data) {
    return <PanelSkeleton loadingLabel={t.cooldownLifecycle.loadingLabel} />;
  }

  // Branches 2–3 — settled failures: denial class vs generic surfaced copy.
  if (error) {
    return <LifecyclePanelError error={error} />;
  }

  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return null;
  }

  const stats = data.adminApplicantCooldownStats;
  const labels = t.cooldownLifecycle;
  const buckets = buildBucketViews({
    activeCount: stats.activeCount,
    expiringSoonCount: stats.expiringSoonCount,
    expiredCount: stats.expiredCount,
    activeLabel: labels.active,
    expiringSoonLabel: labels.expiringSoon(stats.expiringSoonWindowDays),
    expiredLabel: labels.expired,
    bucketAria: labels.bucketAria,
  });

  const openBucket = (href: string) => {
    router.push(href);
  };

  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        transition: theme.transitions.create(["box-shadow", "border-color"], {
          duration: theme.transitions.duration.short,
          easing: theme.transitions.easing.easeOut,
        }),
        "&:hover": {
          boxShadow: theme.shadows[2],
        },
      })}
    >
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
            {t.cooldownLifecycle.title}
          </Typography>
          <Typography
            variant="body2"
            sx={theme => ({ color: theme.palette.text.secondary, mt: 0.5, textWrap: "balance" })}
          >
            {t.cooldownLifecycle.subtitle}
          </Typography>
        </Box>

        <LifecycleRail ariaLabel={t.cooldownLifecycle.title} buckets={buckets} onOpen={openBucket} />

        <LifecycleFooter viewAllLabel={t.cooldownLifecycle.viewAll} onViewAll={() => openBucket("/admin/users")} />
      </CardContent>
    </Card>
  );
}
