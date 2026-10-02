"use client";

/**
 * CountryBreakdownChip — the parts file for `CountryBreakdownRow` (the
 * 150-line view-file convention; the `PanelCard`/`DeleteConfirmDialogBody`
 * extraction precedent): the selected/unselected chip chrome factory and
 * one country chip (flag avatar + locale label + a tabular-nums count
 * pill), styled with the SAME filled/outlined toggle vocabulary as the
 * shared `DirectoryQuickFilterChips` strip so the two chip rows read as
 * one family.
 */

import { Avatar, Box, Chip, Stack, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUserCountryBreakdownQuery_adminUserCountryBreakdown_buckets as CountryBucket } from "@/frontend/graphql/generated/gql/graphql";

/** The selected/unselected chip chrome (filled primary vs outlined muted). */
function chipVariantSx(selected: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    flexShrink: 0,
    minHeight: 44,
    borderRadius: 3,
    ...(selected
      ? {
          fontWeight: 600,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          "&:hover": { bgcolor: theme.palette.primary.main },
        }
      : { borderColor: theme.palette.outlineVariant, color: theme.palette.text.primary }),
  });
}

/** One country chip: flag avatar + locale label + a tabular-nums count pill. */
export function CountryFacetChip(props: {
  readonly bucket: CountryBucket;
  readonly label: string;
  readonly selected: boolean;
  readonly ariaLabel: string;
  readonly onSelect: (code: string) => void;
}): ReactNode {
  const { bucket, label, selected, ariaLabel, onSelect } = props;
  return (
    <Chip
      clickable
      onClick={() => onSelect(bucket.code)}
      aria-pressed={selected}
      aria-label={ariaLabel}
      avatar={
        <Avatar
          sx={(theme: Theme) => ({
            width: 30,
            height: 30,
            fontSize: "1.05rem",
            lineHeight: 1,
            bgcolor: selected ? "transparent" : theme.palette.surfaceContainerLowest,
            border: selected ? "none" : `1px solid ${theme.palette.outlineVariant}`,
          })}
        >
          {bucket.flag}
        </Avatar>
      }
      label={
        <Stack direction="row" spacing={0.75} sx={{ minWidth: 0, alignItems: "center" }}>
          <Box component="span" sx={{ overflowWrap: "anywhere" }}>
            {label}
          </Box>
          <Box
            component="span"
            sx={(theme: Theme) => ({
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 22,
              px: 0.75,
              height: 20,
              borderRadius: 10,
              fontSize: "0.75rem",
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              bgcolor: selected ? theme.palette.onPrimary : theme.palette.surfaceContainerHigh,
              color: selected ? theme.palette.primary.main : theme.palette.text.secondary,
            })}
          >
            {bucket.count}
          </Box>
        </Stack>
      }
      variant={selected ? "filled" : "outlined"}
      sx={chipVariantSx(selected)}
    />
  );
}
