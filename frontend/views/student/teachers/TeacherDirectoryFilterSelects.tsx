"use client";

/**
 * TeacherDirectoryFilterSelects — the five browse-choice fields of the
 * student teacher directory filter bar (recitation, intent, ordering,
 * name search, minimum rating), rendered as grid children of the host
 * `<form>` in `TeacherDirectoryFilterBar`. Presentational only: every
 * select resolves its MUI wire value through the fail-closed RESOLVER
 * lookup tables (the narrowed member is the resolved return value —
 * never a bare boolean predicate, never an `as` cast) — the bar's submit
 * boundary stays the ONLY apply path. The name search is free text (the
 * container trims it on APPLY); the rating select's value space is the
 * explicit string tokens of `ratingTokenOf` (MUI select values
 * are strings; the "any rating" default never collapses to ""). MUI v9
 * `sx`-only styling, theme-palette colors, ≥44px targets, RTL-safe.
 */

import { SearchOutlined } from "@mui/icons-material";
import { InputAdornment, MenuItem, TextField } from "@mui/material";
import { type ReactNode, useId } from "react";
import {
  RATING_FILTER_OPTIONS,
  RATING_OPTION_BY_TOKEN,
  ratingLabelKeyOf,
  ratingTokenOf,
  resolveTeacherMatchingSort,
  SORT_LABEL_KEY_BY_OPTION,
  SORT_OPTIONS,
} from "@/frontend/views/student/teachers/teacherDirectoryBrowseOptions";
import {
  BROWSE_INTENT_OPTIONS,
  type BrowseFilterChoices,
  INTENT_LABEL_KEY_BY_INTENT,
  RECITATION_FILTER_OPTIONS,
  RECITATION_LABEL_KEY_BY_ENUM,
  resolveBrowseIntent,
  resolveRecitationReading,
} from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { Recitation, TeacherDirectory, useAppTranslation } from "@/shared/locale";

/** Shared sx of every field — the 44px touch target. */
const fieldSx = { "& .MuiOutlinedInput-root": { minHeight: 44 } } as const;

/** Commit contract of one select: a narrowed wire token (or `undefined`). */
type TokenNarrower<T> = (token: string) => T | undefined;

/**
 * One labeled select grid item — the generic resolve-and-commit shell.
 * The exported resolver lookups ride in as `narrow`, so an unrecognized
 * wire token resolves `undefined` and commits nothing (fail-closed: the
 * RESOLVED member is the return value — never a bare boolean predicate,
 * which would commit `true` into the draft choice set).
 */
function BrowseSelect<T>(props: {
  readonly id: string;
  readonly label: string;
  readonly testId: string;
  readonly options: readonly T[];
  readonly tokenOf: (option: T) => string;
  readonly labelOf: (option: T) => string;
  readonly narrow: TokenNarrower<T>;
  readonly value: T;
  readonly onCommit: (option: T) => void;
}): ReactNode {
  return (
    <TextField
      id={props.id}
      select
      fullWidth
      label={props.label}
      value={props.tokenOf(props.value)}
      onChange={event => {
        const option = props.narrow(event.target.value);
        if (option !== undefined) {
          props.onCommit(option);
        }
      }}
      data-testid={props.testId}
      sx={fieldSx}
    >
      {props.options.map(option => (
        <MenuItem key={props.tokenOf(option)} value={props.tokenOf(option)}>
          {props.labelOf(option)}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** The five browse-choice fields (grid children of the filter form). */
export function TeacherDirectoryFilterSelects(props: {
  /** The controlled DRAFT choice set the fields edit. */
  readonly draft: BrowseFilterChoices;
  /** Draft-change intent (per-control; never applies on change). */
  readonly onDraftChange: (next: BrowseFilterChoices) => void;
}): ReactNode {
  const { draft, onDraftChange } = props;
  const t = useAppTranslation(TeacherDirectory);
  const recitationT = useAppTranslation(Recitation);
  const recitationId = useId();
  const intentId = useId();
  const sortId = useId();
  const searchId = useId();
  const ratingId = useId();

  return (
    <>
      <BrowseSelect
        id={recitationId}
        label={t.recitationLabel}
        testId="student-teachers-filter-recitation"
        options={RECITATION_FILTER_OPTIONS}
        tokenOf={option => option}
        labelOf={option => recitationT[RECITATION_LABEL_KEY_BY_ENUM[option]]}
        narrow={resolveRecitationReading}
        value={draft.recitation}
        onCommit={recitation => onDraftChange({ ...draft, recitation })}
      />
      <BrowseSelect
        id={intentId}
        label={t.intentLabel}
        testId="student-teachers-filter-intent"
        options={BROWSE_INTENT_OPTIONS}
        tokenOf={option => option}
        labelOf={option => t[INTENT_LABEL_KEY_BY_INTENT[option]]}
        narrow={resolveBrowseIntent}
        value={draft.intent}
        onCommit={intent => onDraftChange({ ...draft, intent })}
      />
      <BrowseSelect
        id={sortId}
        label={t.sortLabel}
        testId="student-teachers-filter-sort"
        options={SORT_OPTIONS}
        tokenOf={option => option}
        labelOf={option => t[SORT_LABEL_KEY_BY_OPTION[option]]}
        narrow={resolveTeacherMatchingSort}
        value={draft.sort}
        onCommit={sort => onDraftChange({ ...draft, sort })}
      />
      <TextField
        id={searchId}
        fullWidth
        label={t.searchLabel}
        placeholder={t.searchPlaceholder}
        value={draft.search}
        onChange={event => {
          onDraftChange({ ...draft, search: event.target.value });
        }}
        data-testid="student-teachers-filter-search"
        sx={{ ...fieldSx, gridColumn: { md: "span 2" } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined />
              </InputAdornment>
            ),
          },
        }}
      />
      <BrowseSelect<number | null>
        id={ratingId}
        label={t.minRatingLabel}
        testId="student-teachers-filter-rating"
        options={RATING_FILTER_OPTIONS}
        tokenOf={ratingTokenOf}
        labelOf={option => t[ratingLabelKeyOf(option)]}
        narrow={token => RATING_OPTION_BY_TOKEN[token]}
        value={draft.minRating}
        onCommit={minRating => onDraftChange({ ...draft, minRating })}
      />
    </>
  );
}
