"use client";

/**
 * AdminCountryDistributionPanel — the admin dashboard's "users by country"
 * DISTRIBUTION panel: one tappable row per dataset-resolvable country
 * population (flag + locale label + share bar + count), deep-linking into
 * the user directory pre-filtered via the guarded `?country=` contract —
 * the dashboard placement of the directory's country facet (the capstone
 * of the country-vocabulary family: dataset → selector → filter chips →
 * URL round-trip → directory facet → BROWSING entry point).
 *
 * Data discipline (mirrors the panel family + the facet's contracts):
 *  - Zero props, no client-side role gating — the page-level server guard
 *    (`withPageAuth`) stays the ONLY authorization boundary; the
 *    `adminUserCountryBreakdown` query is admin-scoped server-side.
 *  - The request window is the SAME `COUNTRY_BREAKDOWN_CHIP_LIMIT` the
 *    directory facet uses — one wire contract, the two surfaces can never
 *    disagree about the top-N.
 *  - The panel's failure degrades PER-BLOCK (the panel-family state
 *    matrix): loading → skeleton card (`aria-busy`); UNAUTHORIZED /
 *    FORBIDDEN → shared `PermissionDeniedFallback`; any other error →
 *    outlined Alert (silent degradation — the errorLink owns toasts).
 *  - Honesty: rows + the trailing unresolved caption always account for the
 *    WHOLE active population the server saw — the share bars' denominator
 *    includes the unresolved remainder, and the caption renders whenever it
 *    is > 0 (never silently dropped). An EMPTY settled payload renders
 *    NOTHING (fresh installs stay clean — an empty panel is not a stub,
 *    the facet's pinned discipline).
 *
 * Locale contract: row labels resolve CLIENT-side through the shared
 * dataset under the LIVE locale (`countryDatasetLabel`) — the Apollo cache
 * survives the LocaleSwitcher's refresh, so a server-localized label would
 * read stale after a toggle; the server-composed label is the fallback for
 * out-of-vocabulary codes.
 *
 * MUI v9 discipline: `sx`-only styling, palette colors via theme callbacks,
 * RTL-safe logical composition, compile-time i18n handles. Internals
 * extracted for the file-size cap: `countryDistributionViews.ts` (row
 * view-model + share math), `CountryDistributionRows.tsx` (row
 * presentation), plus the shared `LifecyclePanelChrome` shells.
 */

import { useQuery } from "@apollo/client/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { adminUserCountryBreakdownQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { CountryDistributionRow } from "@/frontend/views/admin/dashboard/CountryDistributionRows";
import { buildCountryRowViews } from "@/frontend/views/admin/dashboard/countryDistributionViews";
import {
  LifecycleFooter,
  LifecyclePanelError,
  PanelSkeleton,
} from "@/frontend/views/admin/dashboard/LifecyclePanelChrome";
import { PanelCard } from "@/frontend/views/admin/dashboard/PanelCard";
import { COUNTRY_BREAKDOWN_CHIP_LIMIT } from "@/frontend/views/admin/users/hooks/useCountryBreakdown";
import { countryDatasetLabel } from "@/shared/lib/country-dataset";
import { Dashboard, useAppTranslation } from "@/shared/locale";
import { useAppLocale } from "@/shared/locale/localeContext";

export function AdminCountryDistributionPanel(): ReactNode {
  const t = useAppTranslation(Dashboard);
  const locale = useAppLocale();
  const router = useRouter();
  const { data, loading, error } = useQuery(adminUserCountryBreakdownQueryDocument, {
    variables: { limit: COUNTRY_BREAKDOWN_CHIP_LIMIT },
    fetchPolicy: "cache-and-network",
  });

  // Branch 1 — in flight: skeleton card with busy semantics.
  if (loading && !data) {
    return <PanelSkeleton loadingLabel={t.countryDistribution.loadingLabel} />;
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

  const breakdown = data.adminUserCountryBreakdown;

  // Empty settled payload → render NOTHING (fresh installs stay clean —
  // the directory facet's pinned discipline; a bare caption is not content).
  if (breakdown.buckets.length === 0) {
    return null;
  }

  const rows = buildCountryRowViews({
    buckets: breakdown.buckets,
    unresolvedCount: breakdown.unresolvedCount,
    labelOf: bucket => countryDatasetLabel(bucket.code, bucket.label, locale),
    rowAria: t.countryDistribution.rowAria,
  });

  const openCountry = (href: string) => {
    router.push(href);
  };

  return (
    <PanelCard title={t.countryDistribution.title} subtitle={t.countryDistribution.subtitle}>
      <Box component="nav" aria-label={t.countryDistribution.title}>
        <Stack spacing={1}>
          {rows.map(row => (
            <CountryDistributionRow key={row.code} view={row} onOpen={openCountry} />
          ))}
        </Stack>
      </Box>

      {breakdown.unresolvedCount > 0 && (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, mt: 1.5, px: 0.5 })}>
          {t.countryDistribution.unresolved(breakdown.unresolvedCount)}
        </Typography>
      )}

      <LifecycleFooter viewAllLabel={t.countryDistribution.viewAll} onViewAll={() => openCountry("/admin/users")} />
    </PanelCard>
  );
}
