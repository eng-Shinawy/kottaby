"use client";

/**
 * DirectoryStatusDetails — the per-role status/details headline the
 * directory renders instead of a generic status chip, shared by the desktop
 * table and the mobile card list.
 */

import { Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ApplicantStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { DirectoryUserItem } from "@/frontend/views/admin/users/directory";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import { asDirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * THE em-dash fallback for an unset cell value. Kept as a constant so the
 * details cell and the relative-time cell share one glyph source.
 */
const EM_DASH = "—";

interface DirectoryStatusDetailsProps {
  readonly user: DirectoryUserItem;
  readonly labels: Pick<AdminUsersLabels, "directoryChips">;
}

/**
 * Status/details cell — the per-role headline the prototype renders instead
 * of a generic status chip:
 *  - admin/system rows: italic `text.secondary` "System User" line;
 *  - teachers: `pendingReview` (warning lane) while the application is
 *    pending / in evaluation, else `certified` (secondary lane) when the
 *    teacher is approved;
 *  - students: `parentLinked` (success lane) when the student is linked;
 *  - parents: `childrenCount(count)` (neutral lane) when linked;
 *  - anything else: the em-dash fallback.
 */
export function DirectoryStatusDetails({ user, labels }: DirectoryStatusDetailsProps): ReactNode {
  const role = asDirectoryRole(user.role);
  if (role === "Admin") {
    return (
      <Typography variant="body2" sx={theme => ({ fontStyle: "italic", color: theme.palette.text.secondary })}>
        {labels.directoryChips.systemUser}
      </Typography>
    );
  }
  if (role === "Teacher") {
    if (user.applicantStatus === ApplicantStatus.Pending || user.applicantStatus === ApplicantStatus.InEvaluation) {
      return <TonalChip tone="warning" label={labels.directoryChips.pendingReview} />;
    }
    if (user.teacherIsApproved) {
      return <TonalChip tone="secondary" label={labels.directoryChips.certified} />;
    }
    return <EmDash />;
  }
  if (role === "Student") {
    if (user.studentHasParentLink) {
      return <TonalChip tone="success" label={labels.directoryChips.parentLinked} />;
    }
    return <EmDash />;
  }
  const linkedChildren = user.parentLinkedChildrenCount ?? 0;
  if (linkedChildren > 0) {
    return <TonalChip tone="neutral" label={labels.directoryChips.childrenCount(linkedChildren)} />;
  }
  return <EmDash />;
}

/** Muted em-dash rendered in `text.secondary` for empty cell values. */
function EmDash(): ReactNode {
  return (
    <Typography variant="body2" component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
      {EM_DASH}
    </Typography>
  );
}
