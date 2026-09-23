"use client";

/**
 * AdminTeacherIdentityCell — the teacher-directory identity column: the
 * desktop-only `TableCell` (avatar + name + email + copy-email quick
 * action; NO profile link — this directory is read-only) with a trailing
 * explicit view-details quick action (the row's keyboard/touch affordance
 * — the row itself is click-only convenience).
 *
 * Also exports `TeacherDirectoryItem` — the directory list-item row
 * consumed by every cell component of the directory surfaces.
 *
 * The copy-email quick action and the view-details quick action are the
 * shared directory primitives (`DirectoryCopyEmailButton` /
 * `DirectoryViewDetailsButton`).
 *
 * Bidi note (Latin names/emails inside an RTL page): the HTML `dir="ltr"`
 * ATTRIBUTE isolates glyph direction and participates in the bidi
 * algorithm. A CSS `direction: "ltr"` rule MUST NOT be added —
 * stylis-plugin-rtl flips it to `rtl` and it would override the attribute,
 * clipping the START of the text. With the attribute alone, direction stays
 * `ltr` and `text-align: start` shows the head with a trailing ellipsis.
 */

import { Box, Stack, TableCell, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminTeachersQuery } from "@/frontend/graphql/generated/gql/graphql";
import { DirectoryCopyEmailButton } from "@/frontend/views/admin/directory-shared/DirectoryCopyEmailButton";
import { DirectoryViewDetailsButton } from "@/frontend/views/admin/directory-shared/DirectoryViewDetailsButton";
import { useDirectoryCopyEmail } from "@/frontend/views/admin/users/directory";
import { UserAvatar } from "@/frontend/views/admin/users/ui";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

/** Role lane for directory avatars (expression-passed — a `role` string
 * attribute would trip the ARIA role lint against a component prop). */
const TEACHER_AVATAR_ROLE = "Teacher" as const;

/** Directory list-item row consumed by the cell components. */
export type TeacherDirectoryItem = AdminTeachersQuery["adminTeachers"]["items"][number];

interface TeacherIdentityCellProps {
  readonly teacher: TeacherDirectoryItem;
  readonly labels: Pick<AdminTeachersLabels, "quickActions" | "drawer">;
  /** Invoked after the email copy resolves successfully (drives the snackbar). */
  readonly onCopyEmail?: () => void;
  /** Opens the detail drawer (the explicit per-row view-details affordance). */
  readonly onViewDetails?: () => void;
}

/**
 * Desktop identity cell — role-tinted initials avatar (the Teacher lane)
 * + name + ellipsized email + copy-email quick action, with a trailing
 * explicit view-details quick action (the row's keyboard/touch affordance
 * — the row itself is click-only convenience). Read-only surface: the name
 * is NOT a link (there is no teacher detail route).
 */
export function TeacherIdentityCell({
  teacher,
  labels,
  onCopyEmail,
  onViewDetails,
}: TeacherIdentityCellProps): ReactNode {
  const { emailCopied, handleCopyEmail } = useDirectoryCopyEmail(teacher.email, onCopyEmail);
  return (
    <TableCell sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
        <UserAvatar fullName={teacher.name} role={TEACHER_AVATAR_ROLE} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="div"
            title={teacher.name}
            dir="ltr"
            sx={theme => ({
              fontSize: 15,
              fontWeight: 600,
              color: teacher.isDeleted ? theme.palette.text.disabled : theme.palette.text.primary,
              unicodeBidi: "isolate",
              textAlign: "start",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            })}
          >
            {teacher.name}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography
              variant="body2"
              component="div"
              title={teacher.email}
              dir="ltr"
              sx={theme => ({
                fontSize: 13,
                color: teacher.isDeleted ? theme.palette.text.disabled : theme.palette.text.secondary,
                unicodeBidi: "isolate",
                textAlign: "start",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              })}
            >
              {teacher.email}
            </Typography>
            <DirectoryCopyEmailButton
              email={teacher.email}
              copied={emailCopied}
              copyLabel={labels.quickActions.copyEmail}
              copiedLabel={labels.quickActions.emailCopied}
              onCopy={handleCopyEmail}
            />
          </Stack>
        </Box>
        {onViewDetails !== undefined && <ViewDetailsButton labels={labels} onViewDetails={onViewDetails} />}
      </Stack>
    </TableCell>
  );
}

interface ViewDetailsButtonProps {
  readonly labels: Pick<AdminTeachersLabels, "drawer">;
  readonly onViewDetails: () => void;
}

/**
 * The explicit view-details quick action — the row's keyboard/touch
 * affordance for opening the detail drawer (row click stays pointer-only
 * convenience; this button is the real focusable control).
 */
function ViewDetailsButton({ labels, onViewDetails }: ViewDetailsButtonProps): ReactNode {
  return <DirectoryViewDetailsButton viewDetailsLabel={labels.drawer.viewDetails} onViewDetails={onViewDetails} />;
}
