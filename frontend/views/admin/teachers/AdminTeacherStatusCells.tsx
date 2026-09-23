"use client";

/**
 * AdminTeacherStatusCells — the teacher-directory status column content:
 * the approval headline pill, the presence dot-text, and the governance
 * pills (deleted / suspended / blocked, rendered only when the flag is
 * set), wrapped in a wrapping row so the desktop cell and the mobile body
 * row share one composition.
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { TeacherDirectoryItem } from "@/frontend/views/admin/teachers/AdminTeacherIdentityCell";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface TeacherStatusStackProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "statusPills">;
}

/**
 * Status content — the approval headline pill, the presence dot-text, and
 * the governance pills, reused by the desktop cell and the mobile body row.
 */
export function TeacherStatusStack({ teacher, labels }: TeacherStatusStackProps): ReactNode {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", rowGap: 0.5, columnGap: 1, minWidth: 0 }}>
      <TeacherApprovalPill teacher={teacher} labels={labels} />
      <TeacherPresenceLabel teacher={teacher} labels={labels} />
      <TeacherGovernancePills teacher={teacher} labels={labels} />
    </Stack>
  );
}

interface TeacherApprovalPillProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "statusPills">;
}

/** Approval headline pill — approved = success lane, pending = warning lane. */
export function TeacherApprovalPill({ teacher, labels }: TeacherApprovalPillProps): ReactNode {
  const label = teacher.isApproved ? labels.statusPills.approved : labels.statusPills.pending;
  return <TonalChip tone={teacher.isApproved ? "success" : "warning"} label={label} />;
}

interface TeacherPresenceLabelProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "statusPills">;
}

/**
 * Presence indicator — 8px dot + label (never a color-only signal):
 * online = success lane, offline = neutral surface lane.
 */
export function TeacherPresenceLabel({ teacher, labels }: TeacherPresenceLabelProps): ReactNode {
  const text = teacher.isOnline ? labels.statusPills.online : labels.statusPills.offline;
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
      <Box
        component="span"
        aria-hidden
        sx={theme => ({
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: teacher.isOnline ? theme.palette.success.main : theme.palette.onSurfaceVariant,
        })}
      />
      <Typography
        variant="body2"
        component="span"
        sx={theme => ({
          color: teacher.isOnline ? theme.palette.onSurfaceVariant : theme.palette.text.secondary,
          fontWeight: 500,
        })}
      >
        {text}
      </Typography>
    </Box>
  );
}

interface TeacherGovernancePillsProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "statusPills">;
}

/**
 * Governance pills — deleted / suspended / blocked, each rendered only when
 * its flag is set (priority semantics stay on the backend; the pills are a
 * faithful set rendering). Renders nothing when no governance flag is set.
 */
export function TeacherGovernancePills({ teacher, labels }: TeacherGovernancePillsProps): ReactNode {
  return (
    <>
      {teacher.isDeleted && <TonalChip tone="error" label={labels.statusPills.deleted} />}
      {teacher.suspended && <TonalChip tone="warning" label={labels.statusPills.suspended} />}
      {teacher.isBlocked && <TonalChip tone="error" label={labels.statusPills.blocked} />}
    </>
  );
}
