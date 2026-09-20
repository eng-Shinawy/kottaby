"use client";

import { StarBorderOutlined, StarOutlined } from "@mui/icons-material";
import { FormHelperText, Rating, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { Sessions, useAppTranslation } from "@/shared/locale";

interface RateTeacherRatingFieldProps {
  readonly value: number | null;
  /** Compact viewports enlarge the control for touch comfort. */
  readonly compact: boolean;
  readonly fieldError: string | null;
  readonly onChange: (value: number | null) => void;
}

/** The whole-star rating control with its live-validation helper slot. */
export function RateTeacherRatingField({
  value,
  compact,
  fieldError,
  onChange,
}: Readonly<RateTeacherRatingFieldProps>): ReactNode {
  const t = useAppTranslation(Sessions);

  return (
    <Stack sx={{ alignItems: "center", gap: 1 }}>
      {/* The describedby names the helper text ONLY while it renders. */}
      <Rating
        name="teacher-rating"
        value={value}
        size={compact ? "large" : "medium"}
        getLabelText={t.ratingStarAriaLabel}
        emptyLabelText={t.ratingEmptyLabelText}
        aria-invalid={fieldError !== null ? true : undefined}
        aria-describedby={fieldError !== null ? "rate-teacher-rating-error" : undefined}
        icon={<StarOutlined fontSize="large" />}
        emptyIcon={<StarBorderOutlined fontSize="large" />}
        onChange={(_event, next) => onChange(next)}
      />
      {fieldError !== null ? (
        <FormHelperText error id="rate-teacher-rating-error" aria-live="polite">
          {fieldError}
        </FormHelperText>
      ) : null}
    </Stack>
  );
}
