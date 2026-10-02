"use client";

/**
 * TeacherPrepHomeworkList — the previous-homework section of the teacher
 * preparation dialog, split into a focused sibling module (the sessions
 * folder's max-lines discipline, like the report cluster's homework-review
 * module): heading, the section's own failure fold (shared
 * `PrepSectionFrame` — one section's failure never blanks the other), and
 * the newest-first rows.
 *
 * Row vocabulary rides the caller's two handles: `sessions` for the prep
 * copy (empty state, overflow line, the localized Surah/Juz leaf) and
 * `homework` for the shared Jadid/Madi track vocabulary — one Jadid/Madi
 * wording across the homework surfaces. Every row is honest about absence:
 * a track with no assignment renders the track's none-assigned line, an
 * ungraded track renders the muted not-yet-graded chip (never a zero), and
 * a row with neither span renders a single no-assignment line. The empty
 * state itself speaks only after the read actually executed — a skipped
 * query (no student) folds to nothing, mirroring the progress section's
 * null section.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * and the ayah run rides a `dir="ltr"` isolate so the numeric range cannot
 * re-order inside the RTL layout.
 */

import type { ErrorLike } from "@apollo/client";
import { AssignmentOutlined } from "@mui/icons-material";
import { Box, Chip, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import { PrepSectionFrame } from "@/frontend/views/teacher/sessions/TeacherPrepDialog.parts";
import {
  formatPrepAyahRun,
  type PrepHomeworkRow,
  secondaryTextSx,
} from "@/frontend/views/teacher/sessions/teacherPrepDialog.helpers";
import type { HomeworkLabels } from "@/shared/locale/types/homework";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** The muted not-yet-graded chip tone (the shared homework track block's). */
const pendingGradeChipSx = (theme: Theme) => ({
  bgcolor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
});

/** The row's passage-run tone — the body2 variant styles restated on a
 *  plain span (MUI v9: Typography's `component` prop is not valid
 *  directly, so the inline runs ride a Box span with the variant sx). */
const body2SpanSx = (theme: Theme) => ({ ...theme.typography.body2 });

/** One row's session meta caption — the row helper stringified the numeric
 *  history id, so it is parsed back once here and guarded (the mount's
 *  `Number.isFinite` discipline): a finite id rides the homework leaf's
 *  numeric slot verbatim, while a malformed serialization folds to `null`
 *  — a session reference that names no session has no meaningful session
 *  line, so the row degrades honestly to its jadid/madi tracks. */
function PrepRowSessionLine({ sessionId, th }: Readonly<{ sessionId: string; th: HomeworkLabels }>): ReactNode {
  const sessionNumber = Number(sessionId);
  if (!Number.isFinite(sessionNumber)) return null;
  return (
    <Typography variant="caption" sx={secondaryTextSx}>
      {th.sessionLine(sessionNumber)}
    </Typography>
  );
}

/** One track line: the track label with its span (localized Surah/Juz + the
 *  bidi-isolated ayah range) and the grade chip — an ungraded track renders
 *  the muted not-yet-graded chip, never a fabricated zero. */
function PrepTrackLine({
  trackLabel,
  span,
  t,
  th,
}: Readonly<{ trackLabel: string; span: PrepHomeworkRow["jadid"]; t: SessionsLabels; th: HomeworkLabels }>): ReactNode {
  return (
    <Stack sx={{ gap: 0.5 }}>
      <Typography variant="subtitle2">{trackLabel}</Typography>
      {span === null ? (
        <Typography variant="body2" sx={secondaryTextSx}>
          {th.trackNoneAssigned}
        </Typography>
      ) : (
        <Stack sx={{ flexDirection: "row", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Box component="span" dir="auto" sx={body2SpanSx}>
            {span.surahJuz === null ? "—" : t.surahJuzLabel(span.surahJuz)}
          </Box>
          <Box component="span" dir="ltr" sx={body2SpanSx}>
            {formatPrepAyahRun(span.fromAyah, span.toAyah)}
          </Box>
          {/* The ungraded chip's bare "—" announces nothing — the homework
              namespace's pending-chip leaf gives it a spoken state. */}
          <Chip
            size="small"
            data-testid="prep-grade-chip"
            label={span.grade === null ? "—" : String(span.grade)}
            color={span.grade === null ? undefined : "primary"}
            variant={span.grade === null ? undefined : "outlined"}
            sx={span.grade === null ? pendingGradeChipSx : undefined}
            aria-label={span.grade === null ? th.statusPendingChip : t.reportGradeAriaLabel(th.gradeLabel, span.grade)}
          />
        </Stack>
      )}
    </Stack>
  );
}

/** Props for {@link PrepHomeworkList} — row labels ride the caller's two
 *  handles; failure chrome belongs to the shared frame. */
interface PrepHomeworkListProps {
  /** The shaped rows (newest-first, server order untouched). */
  readonly rows: readonly PrepHomeworkRow[];
  /** Rows beyond the shown first page, from the envelope's honest total. */
  readonly hiddenCount: number;
  /** True once the history read actually executed — the skipped query (no
   *  student) must not fabricate the empty state. */
  readonly called: boolean;
  readonly loading: boolean;
  readonly error: ErrorLike | undefined;
  readonly onRetry: () => void;
  readonly t: SessionsLabels;
  readonly th: HomeworkLabels;
}

/** The previous-homework section: heading, the section's own failure fold,
 *  and the rows (or the localized no-assignments-yet state) with the "+N
 *  more" overflow line when deeper history exists — the count rides the
 *  read's execution, not the rows' presence, so a hostile envelope with an
 *  empty first page still speaks its deeper history beneath the empty
 *  state. */
export function PrepHomeworkList({
  rows,
  hiddenCount,
  called,
  loading,
  error,
  onRetry,
  t,
  th,
}: Readonly<PrepHomeworkListProps>): ReactNode {
  // The "+N more" line is hoisted out of the rows branch: a hostile
  // envelope can pair an EMPTY first page with a larger honest total, and
  // the deeper-history count must still speak beneath the empty state —
  // gated on the read's execution (a skipped query has no envelope to
  // count), so rows-present rendering is unchanged.
  const overflowLine =
    called && hiddenCount > 0 ? (
      <Typography variant="body2" data-testid="prep-homework-more" sx={secondaryTextSx}>
        {t.prepMoreHomeworkLine(hiddenCount)}
      </Typography>
    ) : null;
  let content: ReactNode;
  if (rows.length === 0) {
    // The not-executed fold mirrors the progress section's null section:
    // the empty state speaks only once the read actually ran.
    content = called ? (
      <>
        <IconCircleEmptyState
          testId="prep-homework-empty"
          icon={<AssignmentOutlined sx={{ fontSize: 36 }} />}
          title={t.prepHomeworkEmptyTitle}
          body={t.prepHomeworkEmptyBody}
        />
        {overflowLine}
      </>
    ) : null;
  } else {
    content = (
      <Stack sx={{ gap: 2 }} data-testid="prep-homework-list">
        {rows.map(row => (
          <Stack key={row.id} sx={{ gap: 1 }}>
            <PrepRowSessionLine sessionId={row.sessionId} th={th} />
            {row.jadid === null && row.madi === null ? (
              <Typography variant="body2" sx={secondaryTextSx}>
                {th.trackNoneAssigned}
              </Typography>
            ) : (
              <>
                <PrepTrackLine trackLabel={th.trackJadid} span={row.jadid} t={t} th={th} />
                <PrepTrackLine trackLabel={th.trackMadi} span={row.madi} t={t} th={th} />
              </>
            )}
          </Stack>
        ))}
        {overflowLine}
      </Stack>
    );
  }
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t.prepPreviousHomeworkHeading}
      </Typography>
      <PrepSectionFrame loading={loading} error={error} onRetry={onRetry}>
        {content}
      </PrepSectionFrame>
    </Stack>
  );
}
