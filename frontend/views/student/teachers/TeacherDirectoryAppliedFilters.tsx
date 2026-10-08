"use client";

/**
 * TeacherDirectoryAppliedFilters — the applied-filter state chips of the
 * student teacher directory: outlined chips under the filter bar naming
 * the choices that DRIVE the query right now (the draft edits in the bar
 * are NOT what the server sees until submit — these chips make the
 * applied state visible in every body branch, skeleton and error
 * included). Every chip is CONDITIONAL — a choice at its null/default
 * "no constraint" value stays silent: a set recitation or subject intent
 * gets its own chip (both default to `null` = all readings / all
 * subjects), while the optional trio appends a chip ONLY when
 * non-default — a non-empty name search (the trimmed string, quoted), a
 * minimum-rating floor (via the shared label table), and a non-legacy
 * ordering (the default top-rated sort stays silent). Content is composed
 * DATA next to a decorative filter icon — no interpolated namespace copy;
 * the accessible name of the region is the dedicated `appliedFiltersLabel`
 * key. RTL-safe (flex + logical gap only).
 */

import { FilterListOutlined } from "@mui/icons-material";
import { Chip, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { TeacherMatchingSort } from "@/frontend/graphql/generated/gql/graphql";
import {
  ratingLabelKeyOf,
  SORT_LABEL_KEY_BY_OPTION,
} from "@/frontend/views/student/teachers/teacherDirectoryBrowseOptions";
import {
  type BrowseFilterChoices,
  INTENT_LABEL_KEY_BY_INTENT,
  RECITATION_LABEL_KEY_BY_ENUM,
} from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { Recitation, TeacherDirectory, useAppTranslation } from "@/shared/locale";

interface TeacherDirectoryAppliedFiltersProps {
  /** The applied choice set (the filters of the live query). */
  readonly choices: BrowseFilterChoices;
}

/** One applied-filter chip: a stable source key + its composed summary. */
interface AppliedChip {
  readonly key: string;
  readonly summary: string;
}

/** The applied-filter summary chips of the student browse. */
export function TeacherDirectoryAppliedFilters({ choices }: Readonly<TeacherDirectoryAppliedFiltersProps>): ReactNode {
  const t = useAppTranslation(TeacherDirectory);
  const recitationT = useAppTranslation(Recitation);

  const search = choices.search.trim();
  const appliedChips: readonly AppliedChip[] = [
    choices.recitation === null
      ? null
      : { key: "recitation", summary: recitationT[RECITATION_LABEL_KEY_BY_ENUM[choices.recitation]] },
    choices.intent === null ? null : { key: "intent", summary: t[INTENT_LABEL_KEY_BY_INTENT[choices.intent]] },
    search.length > 0 ? { key: "search", summary: `${t.appliedSearchPrefix} "${search}"` } : null,
    choices.minRating === null
      ? null
      : { key: "rating", summary: `${t.appliedRatingPrefix} ${t[ratingLabelKeyOf(choices.minRating)]}` },
    choices.sort === TeacherMatchingSort.RatingDesc
      ? null
      : { key: "sort", summary: `${t.appliedSortPrefix} ${t[SORT_LABEL_KEY_BY_OPTION[choices.sort]]}` },
  ].filter((chip): chip is AppliedChip => chip !== null);

  return (
    <Stack
      aria-label={t.appliedFiltersLabel}
      data-testid="student-teachers-applied-filters"
      sx={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 1, maxWidth: "100%" }}
    >
      {appliedChips.map(chip => (
        <Chip
          key={chip.key}
          icon={<FilterListOutlined />}
          label={chip.summary}
          size="small"
          variant="outlined"
          sx={theme => ({
            borderColor: theme.palette.outlineVariant,
            color: theme.palette.onSurfaceVariant,
            bgcolor: "transparent",
            maxWidth: "100%",
            "& .MuiChip-icon": { color: theme.palette.onSurfaceVariant },
          })}
        />
      ))}
    </Stack>
  );
}
