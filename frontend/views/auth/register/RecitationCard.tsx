"use client";

import { Card, CardContent, useTheme } from "@mui/material";
import type { RecitationReading } from "@/frontend/graphql/generated/gql/graphql";
import { getRecitationDescription, getRecitationLabel } from "@/frontend/lib/recitation-labels";
import { RecitationCardContent } from "@/frontend/views/auth/register";
import type { RecitationLabels } from "@/shared/locale/types/recitation";

export interface RecitationCardProps {
  /** The reading this card represents. */
  readonly reading: RecitationReading;
  /** Whether this reading is the currently selected one. */
  readonly isSelected: boolean;
  /** Whether this reading gets the "Most popular" badge (first in the catalog). */
  readonly isPopular: boolean;
  /** Translated labels for the recitation namespace. */
  readonly labels: RecitationLabels;
  /** Called when the user selects this reading. */
  readonly onSelect: (value: RecitationReading) => void;
}

export function RecitationCard({ reading, isSelected, isPopular, labels, onSelect }: RecitationCardProps) {
  const theme = useTheme();
  const label = getRecitationLabel(reading, labels);
  const description = getRecitationDescription(reading, labels);

  return (
    <Card
      // These cards were pointer-only (`<div onClick>`) — a
      // complete keyboard lockout (WCAG 2.1.1) and role/name-less to
      // assistive tech. Native <button> gives focus + Enter/Space, and
      // `aria-pressed` publishes the selected state to AT (the
      // single-choice constraint stays a form-level invariant).
      component="button"
      type="button"
      aria-pressed={isSelected}
      onClick={() => onSelect(reading)}
      sx={{
        display: "block",
        width: "100%",
        // Fill the stretched grid row so the "Most popular" badge (or a
        // longer description) never makes one card taller than its siblings.
        height: "100%",
        p: 0,
        textAlign: "start",
        font: "inherit",
        color: "inherit",
        cursor: "pointer",
        border: 1.5,
        borderColor: isSelected ? "var(--mui-palette-primary-main)" : "var(--mui-palette-outlineVariant)",
        bgcolor: isSelected ? "var(--mui-palette-primaryContainer)" : "var(--mui-palette-background-paper)",
        borderRadius: 2,
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "var(--mui-palette-primary-main)",
          outlineOffset: 2,
        },
        // Subtle copper left-accent on selected cards — emphasizes the
        // brand identity (midnight blue selected surface + copper stripe).
        boxShadow: isSelected ? `inset 3px 0 0 ${theme.palette.secondary.main}` : theme.shadows[0],
        transition: theme.transitions.create(["border-color", "box-shadow", "background-color"], {
          duration: theme.transitions.duration.short,
        }),
        "&:hover": {
          borderColor: isSelected ? "var(--mui-palette-primary-main)" : "var(--mui-palette-primary-light)",
          boxShadow: isSelected
            ? `inset 3px 0 0 ${theme.palette.secondary.main}, ${theme.shadows[2]}`
            : theme.shadows[3],
        },
        position: "relative",
        overflow: "visible",
      }}
      elevation={0}
    >
      <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
        <RecitationCardContent
          label={label}
          description={description}
          isSelected={isSelected}
          isPopular={isPopular}
          mostPopularLabel={labels.mostPopular}
        />
      </CardContent>
    </Card>
  );
}
