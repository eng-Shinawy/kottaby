"use client";

/**
 * AdminStudentIdentityCell — the desktop identity cell family of the
 * admin student directory (extracted from `AdminStudentRowCells`):
 *  - `StudentIdentityCell`: role-tinted initials avatar (the Student lane)
 *    + name + ellipsized email + copy-email quick action, with a trailing
 *    explicit view-details quick action (the row's keyboard/touch
 *    affordance — the row itself is click-only convenience). Read-only
 *    surface: the name is NOT a link (there is no student detail route).
 *  - `ViewDetailsButton`: the explicit view-details quick action.
 *
 * The copy-email quick action and the view-details quick action are the
 * shared directory primitives (`DirectoryCopyEmailButton` /
 * `DirectoryViewDetailsButton`).
 */

import { Box, TableCell, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryCopyEmailButton } from "@/frontend/views/admin/directory-shared/DirectoryCopyEmailButton";
import { DirectoryViewDetailsButton } from "@/frontend/views/admin/directory-shared/DirectoryViewDetailsButton";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { useDirectoryCopyEmail } from "@/frontend/views/admin/users/directory";
import { UserAvatar } from "@/frontend/views/admin/users/ui";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

/** Role lane for directory avatars (expression-passed — a `role` string
 * attribute would trip the ARIA role lint against a component prop). */
const STUDENT_AVATAR_ROLE = "Student" as const;

interface StudentIdentityCellProps {
  readonly student: StudentDirectoryItem;
  readonly labels: Pick<AdminStudentsLabels, "quickActions" | "drawer">;
  /** Invoked after the email copy resolves successfully (drives the snackbar). */
  readonly onCopyEmail?: () => void;
  /** Opens the detail drawer (the explicit per-row view-details affordance). */
  readonly onViewDetails?: () => void;
}

export function StudentIdentityCell({
  student,
  labels,
  onCopyEmail,
  onViewDetails,
}: StudentIdentityCellProps): ReactNode {
  const { emailCopied, handleCopyEmail } = useDirectoryCopyEmail(student.email, onCopyEmail);
  return (
    <TableCell sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
        <UserAvatar fullName={student.name} role={STUDENT_AVATAR_ROLE} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="div"
            title={student.name}
            dir="ltr"
            sx={{
              fontSize: 15,
              fontWeight: 600,
              unicodeBidi: "isolate",
              textAlign: "start",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {student.name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            {/* MUI Tooltip (not a bare `title`) — the email is the row's
                identification datum and the column truncates it mid-address,
                so the full value must be reachable through a visible hover /
                focus affordance as well as the copy action. */}
            <Tooltip title={student.email} placement="top" enterDelay={350} arrow>
              <Typography
                variant="body2"
                component="div"
                dir="ltr"
                sx={theme => ({
                  fontSize: 13,
                  color: theme.palette.text.secondary,
                  unicodeBidi: "isolate",
                  textAlign: "start",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                  cursor: "default",
                })}
              >
                {student.email}
              </Typography>
            </Tooltip>
            <DirectoryCopyEmailButton
              email={student.email}
              copied={emailCopied}
              copyLabel={labels.quickActions.copyEmail}
              copiedLabel={labels.quickActions.emailCopied}
              onCopy={handleCopyEmail}
            />
          </Box>
        </Box>
        {onViewDetails !== undefined && <ViewDetailsButton labels={labels} onViewDetails={onViewDetails} />}
      </Box>
    </TableCell>
  );
}

interface ViewDetailsButtonProps {
  readonly labels: Pick<AdminStudentsLabels, "drawer">;
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
