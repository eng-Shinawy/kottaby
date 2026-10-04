"use client";

/**
 * AdminApplicantRow — one body row of the desktop `AdminApplicantsTable`:
 * identity (avatar/name profile link/email + copy-email quick action),
 * status (lifecycle chip + governance pills), attempts, last-attempt
 * timestamp, cooldown (date or cooling-down chip), joined timestamp, and
 * the explicit view-profile action.
 *
 * The row is NOT clickable — the queue is a read-only surface with no
 * drawer; the identity cell's name link and the actions column's
 * view-profile IconButton are the two navigation affordances to the
 * governance page (`/admin/users/{id}`). The row enforces the 72px
 * body-row height on the CELLS (a row's own height is a minimum;
 * `py: 1.5` alone measured short once line-heights settled).
 * `verticalAlign: middle` keeps single-line cells centered within the 72px
 * band. Even rows carry a faint zebra tint (`action.hover`); the hover
 * upgrade stays a pointer-free highlight (no cursor — the row itself is
 * inert). Soft-deleted applicants keep the same row treatment — the
 * deleted governance pill carries the signal.
 */

import { TableCell } from "@mui/material";
import { memo, type ReactNode } from "react";
import { DirectoryBodyRow } from "@/frontend/views/admin/directory-shared/DirectoryBodyRow";
import {
  ApplicantAttemptsText,
  ApplicantCooldownContent,
  type ApplicantDirectoryItem,
  ApplicantIdentityCell,
  ApplicantJoinedText,
  ApplicantLastAttemptText,
  ApplicantStatusStack,
  ViewProfileButton,
} from "@/frontend/views/admin/teachers/AdminApplicantRowCells";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface AdminApplicantRowProps {
  readonly applicant: ApplicantDirectoryItem;
  readonly labels: AdminTeachersLabels;
  readonly locale: "ar" | "en";
  /** `true` paints the faint zebra tint on this row (odd body-row index). */
  readonly striped?: boolean;
  /** Invoked after the identity cell's copy-email action resolves. */
  readonly onCopyEmail?: () => void;
}

export const AdminApplicantRow = memo(function AdminApplicantRow({
  applicant,
  labels,
  locale,
  striped,
  onCopyEmail,
}: AdminApplicantRowProps): ReactNode {
  return (
    <DirectoryBodyRow striped={striped}>
      <ApplicantIdentityCell applicant={applicant} labels={labels} onCopyEmail={onCopyEmail} />
      <TableCell sx={{ minWidth: 0 }}>
        <ApplicantStatusStack applicant={applicant} labels={labels} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <ApplicantAttemptsText applicant={applicant} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <ApplicantLastAttemptText applicant={applicant} locale={locale} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <ApplicantCooldownContent applicant={applicant} locale={locale} labels={labels} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <ApplicantJoinedText applicant={applicant} locale={locale} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <ViewProfileButton applicantId={applicant.id} applicantName={applicant.name} labels={labels} />
      </TableCell>
    </DirectoryBodyRow>
  );
});
