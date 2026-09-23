"use client";

/**
 * FilterSectionShell — the shared filter-card shell of the admin surfaces'
 * filter bars: the tinted (`surfaceContainerLow` / `outlineVariant`) rounded
 * grid card plus the leading heading band (`FilterListOutlined` icon over
 * the bar's title). Consumers pass the grid template, the testid, the title
 * copy, and — for submit-narrowed bars — the form submit handler (the shell
 * renders the `component="form"` `noValidate` card only when one is given;
 * otherwise a plain `section`). The card recipe and the band live HERE
 * exactly once.
 *
 * MUI v9 `sx`-only discipline, theme-palette colors.
 */

import { FilterListOutlined } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface FilterSectionShellProps {
  /** The filter card's `data-testid` (the suites + e2e drive it). */
  readonly testId: string;
  /** The accessible name of the card (omitted when the bar has none). */
  readonly ariaLabel?: string;
  /** The heading-band title (the bar's localized copy). */
  readonly title: string;
  /** The grid column template (each bar owns its field count). */
  readonly gridTemplateColumns: Record<string, string>;
  /** Submit-narrowed bars host the card on a real `<form>` (noValidate). */
  readonly onSubmit?: (event: React.SubmitEvent<HTMLFormElement>) => void;
  /** The filter fields + action row (rendered inside the grid). */
  readonly children: ReactNode;
}

/** The tinted filter-card shell + heading band shared by the admin filter bars. */
export function FilterSectionShell({
  testId,
  ariaLabel,
  title,
  gridTemplateColumns,
  onSubmit,
  children,
}: Readonly<FilterSectionShellProps>): ReactNode {
  return (
    <Box
      component={onSubmit === undefined ? "section" : "form"}
      {...(onSubmit === undefined ? {} : { onSubmit, noValidate: true })}
      {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
      data-testid={testId}
      sx={theme => ({
        display: "grid",
        gap: 2,
        gridTemplateColumns,
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <Stack sx={{ flexDirection: "row", alignItems: "center", gap: 1, gridColumn: "1 / -1" }}>
        <FilterListOutlined fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} />
        <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Stack>
      {children}
    </Box>
  );
}
