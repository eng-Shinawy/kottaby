"use client";

/**
 * TeacherDirectoryCard — one PII-minimal teacher card of the student
 * directory grid.
 *
 * Anatomy: avatar circle carrying the teacher's initial (theme
 * primary/onPrimary pair with a subtle container-tinted ring) beside the
 * display name + the honest country line (rendered only when the profile
 * records one); a trailing online-badge pill (leading dot + `onlineNow`)
 * painted from the success palette only when the compose-rule eligible
 * flag is `true`; a rating row (the recorded average as an amber star +
 * bold value in a warning-tinted pill, or the muted `unrated` fallback —
 * an honest null, never a fabricated zero); the two labeled chip sections
 * — Qira'ah certifications resolved through the `recitation` namespace's
 * per-reading display names and the fluency list through the presentation
 * vocabulary (known tokens localized, unknown tokens verbatim) — and the
 * full-width "Request Session" CTA pinned to the card foot (`mt: "auto"`)
 * so grid rows align regardless of chip counts. The CTA opens the
 * grid-level request dialog (ONE instance keyed by the selected teacher —
 * never one dialog per card); the card itself is NOT clickable, so no
 * propagation guard is owed.
 *
 * RTL-safe: the layout is flex + logical spacing (`gap`) only, so the
 * whole card mirrors under the Arabic locale. MUI v9 `sx`-only styling,
 * theme-palette colors, hover elevation + lift transition, ≥44px targets.
 */

import { EventAvailableOutlined as RequestIcon, StarOutlined } from "@mui/icons-material";
import { Avatar, Box, Button, Card, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { BrowseAvailableTeachersQuery_browseAvailableTeachers_items } from "@/frontend/graphql/generated/gql/graphql";
import { CardChipSection } from "@/frontend/views/student/teachers/TeacherDirectoryCardChipSection";
import {
  RECITATION_LABEL_KEY_BY_ENUM,
  resolveLanguageLabel,
} from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { Recitation, TeacherDirectory, useAppTranslation } from "@/shared/locale";

interface TeacherDirectoryCardProps {
  /** One settled `browseAvailableTeachers` item (the projected public card). */
  readonly teacher: BrowseAvailableTeachersQuery_browseAvailableTeachers_items;
  /** Request intent — opens the grid-level request dialog for this teacher. */
  readonly onRequestSession: (teacher: BrowseAvailableTeachersQuery_browseAvailableTeachers_items) => void;
}

/** The student-facing teacher card. */
export function TeacherDirectoryCard({ teacher, onRequestSession }: Readonly<TeacherDirectoryCardProps>): ReactNode {
  const t = useAppTranslation(TeacherDirectory);
  const recitationT = useAppTranslation(Recitation);
  const initial = teacher.fullName.charAt(0).toUpperCase();

  return (
    <Card
      elevation={0}
      data-testid={`student-teachers-card-${teacher.id}`}
      sx={theme => ({
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        p: 2.5,
        border: "1px solid",
        borderColor: theme.palette.border.light,
        borderRadius: 3,
        bgcolor: theme.palette.background.paper,
        boxShadow: theme.palette.shadow.card,
        transition: theme.transitions.create(["box-shadow", "transform"]),
        "&:hover": { boxShadow: theme.palette.shadow.cardHover, transform: "translateY(-2px)" },
      })}
    >
      <CardHeaderRow teacher={teacher} initial={initial} onlineLabel={t.onlineNow} />
      {teacher.averageRating === null ? (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.unrated}
        </Typography>
      ) : (
        <Stack
          sx={theme => ({
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "flex-start",
            gap: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: 999,
            bgcolor: theme.palette.warningContainer,
            color: theme.palette.onWarningContainer,
          })}
        >
          <StarOutlined fontSize="small" />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {teacher.averageRating}
          </Typography>
        </Stack>
      )}
      <CardChipSection
        caption={t.cardRecitations}
        labels={teacher.recitations.map(reading => recitationT[RECITATION_LABEL_KEY_BY_ENUM[reading]])}
      />
      <CardChipSection
        caption={t.cardLanguages}
        labels={teacher.languages.map(token => resolveLanguageLabel(token, t))}
      />
      <Button
        variant="contained"
        startIcon={<RequestIcon />}
        onClick={() => onRequestSession(teacher)}
        data-testid={`student-teachers-request-${teacher.id}`}
        sx={{ ...focusVisibleRingSx, mt: "auto", minHeight: 44 }}
      >
        {t.requestSessionCta}
      </Button>
    </Card>
  );
}

/** The identity row: ringed avatar, name + honest country line, online pill. */
function CardHeaderRow(props: {
  readonly teacher: BrowseAvailableTeachersQuery_browseAvailableTeachers_items;
  readonly initial: string;
  readonly onlineLabel: string;
}): ReactNode {
  const { teacher, initial, onlineLabel } = props;
  return (
    // flexWrap lets the pill drop to its own line on narrow cards instead
    // of squeezing the name into mid-word breaks (EN's "Available now" is
    // longer than AR's badge text — the row must yield, never crush).
    <Stack sx={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
      <Avatar
        alt={teacher.fullName}
        sx={theme => ({
          width: 48,
          height: 48,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          boxShadow: `0 0 0 2px ${theme.palette.primaryContainer}`,
        })}
      >
        {initial}
      </Avatar>
      <Stack sx={{ gap: 0.5, minWidth: 0, flexGrow: 1 }}>
        <Typography variant="h6" component="h3" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
          {teacher.fullName}
        </Typography>
        {teacher.country !== null && teacher.country !== "" ? (
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {teacher.country}
          </Typography>
        ) : null}
      </Stack>
      {teacher.isOnline ? (
        <Stack
          data-testid={`student-teachers-online-${teacher.id}`}
          sx={theme => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 0.75,
            px: 1.25,
            py: 0.5,
            borderRadius: 999,
            bgcolor: theme.palette.successContainer,
            color: theme.palette.onSuccessContainer,
            // The badge never wraps: a two-line pill inside the name row
            // breaks the header rhythm on narrow cards.
            whiteSpace: "nowrap",
            flexShrink: 0,
          })}
        >
          <Box
            aria-hidden
            sx={theme => ({ width: 8, height: 8, borderRadius: "50%", bgcolor: theme.palette.success.main })}
          />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {onlineLabel}
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
