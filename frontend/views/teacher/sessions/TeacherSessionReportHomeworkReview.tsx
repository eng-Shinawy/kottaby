"use client";

/**
 * TeacherSessionReportHomeworkReview — the read-only homework display for
 * the teacher session-report dialog (focused sibling module; the dialog
 * and parts files ride the 150-line views ceiling).
 *
 * TWO consumers, one shape:
 *  - `review` mode (completed session with a submitted report): the
 *    Jadid/Madi assignment the teacher recorded WITH the report — until
 *    this component existed the dialog fetched `sessionHomework` but never
 *    rendered it (the homework data was fetched and dropped).
 *  - `prepare` mode (started session, "Review prior homework"): the
 *    session's CURRENT assignment, read-only — the previous editable
 *    Jadid/Madi fields were a dead-end UI (no submit path exists for a
 *    started session; the mutation denies it server-side).
 *
 * Every track is honest about absence: a null ayah span renders the
 * `reportTrackEmptyLabel` copy, a null grade renders no grade chip —
 * never a fabricated zero. The ayah span rides a `dir="ltr"` isolate so
 * the numeric range cannot re-order inside the RTL layout (the same
 * bidi-isolate discipline as the ledger stamps).
 */

import { Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionHomeWorkQuery } from "@/frontend/graphql/generated/gql/graphql";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

type SessionHomework = NonNullable<SessionHomeWorkQuery["sessionHomework"]>;

interface TrackProps {
  readonly title: string;
  readonly gradeLabel: string;
  readonly fromAyah: number | null | undefined;
  readonly toAyah: number | null | undefined;
  readonly surahJuz: string | null | undefined;
  readonly grade: number | null | undefined;
  readonly t: SessionsLabels;
}
/** One assignment track: title, ayah span + surah/juz line, grade chip. */
function HomeworkTrack({ title, gradeLabel, fromAyah, toAyah, surahJuz, grade, t }: Readonly<TrackProps>): ReactNode {
  const hasSpan = typeof fromAyah === "number" && typeof toAyah === "number";
  return (
    <Stack sx={{ gap: 0.5 }}>
      <Typography variant="subtitle2">{title}</Typography>
      {hasSpan ? (
        // The row container must be a Stack (div): the grade Chip renders a
        // <div>, and a div inside the variant-body2 <p> breaks hydration
        // ("In HTML, <div> cannot be a descendant of <p>").
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="body2" component="span" dir="ltr">
            {`${fromAyah}–${toAyah}`}
          </Typography>
          <Typography variant="body2" component="span">
            {typeof surahJuz === "string" ? t.surahJuzLabel(surahJuz) : t.reportTrackEmptyLabel}
          </Typography>
          {typeof grade === "number" ? (
            <Chip
              data-testid="session-homework-grade-chip"
              size="small"
              color="primary"
              variant="outlined"
              label={String(grade)}
              aria-label={t.reportGradeAriaLabel(gradeLabel, grade)}
            />
          ) : null}
        </Stack>
      ) : (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.reportTrackEmptyLabel}
        </Typography>
      )}
    </Stack>
  );
}

interface HomeworkReviewProps {
  readonly homework: SessionHomework | null;
  readonly t: SessionsLabels;
}

/** The two-track read-only homework display (Jadid + Madi). */
export function TeacherSessionReportHomeworkReview({ homework, t }: Readonly<HomeworkReviewProps>): ReactNode {
  if (homework === null) {
    return (
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.secondary })}
        data-testid="session-homework-empty"
      >
        {t.caseReviewEmptyHomework}
      </Typography>
    );
  }
  return (
    <Stack sx={{ gap: 2 }} data-testid="session-homework-review">
      <HomeworkTrack
        title={t.jadidSectionTitle}
        gradeLabel={t.reportGradeJadidLabel}
        fromAyah={homework.currentFromAyah}
        toAyah={homework.currentToAyah}
        surahJuz={homework.currentSurahJuz}
        grade={homework.currentGrade}
        t={t}
      />
      <HomeworkTrack
        title={t.madiSectionTitle}
        gradeLabel={t.reportGradeMadiLabel}
        fromAyah={homework.revisionFromAyah}
        toAyah={homework.revisionToAyah}
        surahJuz={homework.revisionSurahJuz}
        grade={homework.revisionGrade}
        t={t}
      />
    </Stack>
  );
}
