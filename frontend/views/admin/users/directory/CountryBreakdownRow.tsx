"use client";

/**
 * CountryBreakdownRow — the admin users directory's "users by country"
 * distribution facet (`AdminUserCountryBreakdown`). A horizontally
 * scrollable chip row where each chip is one dataset-resolvable country
 * population (flag avatar + locale display label + a count pill), styled
 * with the SAME filled/outlined toggle vocabulary as the shared
 * `DirectoryQuickFilterChips` strip so the two chip rows read as one
 * family.
 *
 * Click-through contract: a chip hands its ISO code to `onSelect`, which
 * the container routes through the SAME canonical seed bridge +
 * page-resetting `setCountryFilter` setter the toolbar's country select
 * drives — so the URL mirrors the selection (`?country=CODE`, the
 * directory's shareable deep-link contract), the `ActiveFiltersRow` chip
 * renders, and re-activating the SAME chip toggles the filter OFF
 * (facet chips behave like the quick-filter chips, not forced navigation).
 *
 * Honesty contract: the server labels every bucket (shared dataset,
 * request locale) and reports `unresolvedCount` — the population a chip
 * CANNOT represent (legacy free-text / never-set countries). That
 * remainder renders as a muted trailing caption, so chips + caption always
 * account for the whole active population; it is never silently dropped.
 * The facet renders NOTHING while the aggregate is missing (fresh
 * directories stay clean — an empty facet is not a stub).
 *
 * Locale contract: the display label resolves CLIENT-side through the
 * SHARED single resolution point (`countryDatasetLabel` — the dataset keyed
 * by the LIVE locale, the server-composed label as the out-of-vocabulary
 * fallback). Rationale: the LocaleSwitcher refreshes server components but
 * the Apollo cache survives, so a server-localized label would read stale
 * after a locale toggle — the dataset is already in the client bundle and
 * is the SAME source the server composed from, so one resolution point
 * renders both locales correctly with zero extra round-trips.
 *
 * RTL-safe by construction: the scroll row and gaps are physical-layout
 * free (`gap`, `overflowX`), the flag avatar rides MUI Chip's logical
 * `marginInlineEnd`, and the count pill is a plain inline box. All colors
 * resolve through theme-callback sx — nothing hardcoded.
 */

import { PublicOutlined } from "@mui/icons-material";
import { Box, Stack, type Theme, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUserCountryBreakdownQuery_adminUserCountryBreakdown_buckets as CountryBucket } from "@/frontend/graphql/generated/gql/graphql";
import { CountryFacetChip } from "@/frontend/views/admin/users/directory/CountryBreakdownChip";
import { countryDatasetLabel } from "@/shared/lib/country-dataset";
import { useAppLocale } from "@/shared/locale/localeContext";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface CountryBreakdownRowProps {
  readonly labels: Pick<AdminUsersLabels, "countryBreakdown">;
  /** The server-resolved top-N buckets (empty array → the facet renders nothing). */
  readonly buckets: readonly CountryBucket[];
  /** Active-population remainder the chips cannot represent (rendered only when > 0). */
  readonly unresolvedCount: number;
  /** The currently applied country filter (a chip whose code matches renders active). */
  readonly activeCountry: string;
  /** Writes the ISO code through the shared country-filter setter (toggle on re-activate). */
  readonly onSelect: (code: string) => void;
}

/** The selected/unselected chip chrome lives in the parts file (`CountryBreakdownChip`). */

/** The section title's muted icon chrome. */
const sectionIconSx = (theme: Theme) => ({ fontSize: 18, color: theme.palette.text.secondary });

/** The section title's muted overline chrome. */
const sectionTitleSx = (theme: Theme) => ({ color: theme.palette.text.secondary, lineHeight: 1.6 });

export function CountryBreakdownRow(props: CountryBreakdownRowProps): ReactNode {
  const { labels, buckets, unresolvedCount, activeCountry, onSelect } = props;
  const locale = useAppLocale();
  if (buckets.length === 0) {
    return null;
  }
  return (
    <Stack component="section" spacing={0.5} aria-label={labels.countryBreakdown.title} sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={0.75} sx={{ px: 0.5, alignItems: "center" }}>
        <PublicOutlined sx={sectionIconSx} aria-hidden="true" />
        <Typography variant="overline" component="h2" sx={sectionTitleSx}>
          {labels.countryBreakdown.title}
        </Typography>
      </Stack>
      <Box
        sx={{
          display: "flex",
          gap: 1,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          py: 0.5,
        }}
      >
        {buckets.map(bucket => {
          const selected = activeCountry !== "" && activeCountry.toUpperCase() === bucket.code.toUpperCase();
          // Live-locale label via the SHARED resolution point (dataset lookup,
          // server-composed label as the out-of-vocabulary fallback).
          const label = countryDatasetLabel(bucket.code, bucket.label, locale);
          return (
            <CountryFacetChip
              key={bucket.code}
              bucket={bucket}
              label={label}
              selected={selected}
              ariaLabel={labels.countryBreakdown.chipAriaLabel.replace("{label}", label)}
              onSelect={onSelect}
            />
          );
        })}
        {unresolvedCount > 0 && (
          <Typography
            variant="body2"
            sx={(theme: Theme) => ({
              alignSelf: "center",
              px: 1,
              flexShrink: 0,
              color: theme.palette.text.secondary,
              whiteSpace: "nowrap",
            })}
          >
            {labels.countryBreakdown.unresolved.replace("{count}", String(unresolvedCount))}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
