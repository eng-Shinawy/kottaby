"use client";

/**
 * CreateUserRoleSegments — the segmented role control of the admin
 * "create user" dialog (extracted from `CreateUserDialog.tsx`): student /
 * parent / teacher-applicant segments (admin stays excluded). The submitted
 * `role` value and validation behavior are unchanged from the pre-extraction
 * select; only the control surface is this segmented row.
 */

import {
  FamilyRestroomOutlined as ParentIcon,
  SchoolOutlined as StudentIcon,
  PersonAddAltOutlined as TeacherApplicantIcon,
} from "@mui/icons-material";
import { Box, Button } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { AdminDialogFieldLabel, type CreateUserDialogRole } from "@/frontend/views/admin/users/dialogs";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const CREATE_ROLE_LABEL_ID = "admin-users-create-role-label";

/** Segmented-role button styling — selected segment is a success-tinted
 *  pill with a 2px success border; unselected renders fully transparent
 *  inside the track (the transparent border keeps segment height stable
 *  across states). The tinted fill (not bare paper) keeps the selected
 *  state unambiguous in dark mode, where `background.paper` reads DARKER
 *  than the `surfaceContainerHigh` track and the pill visually sinks.
 *  No elevation shadow: inside a 4px-gap track a drop shadow spills onto
 *  the transparent neighbors and past the track edge, making the state
 *  borders read as interleaved/overflowing — border + tint + text weight
 *  carry the selected state on their own. */
function roleSegmentSx(selected: boolean) {
  return (theme: Theme) => ({
    flex: 1,
    minWidth: 0,
    minHeight: 54,
    borderRadius: "8px",
    fontWeight: selected ? 600 : 500,
    color: selected ? theme.palette.success.main : theme.palette.text.secondary,
    backgroundColor: selected
      ? `color-mix(in srgb, ${theme.palette.success.main} 16%, ${theme.palette.background.paper})`
      : "transparent",
    border: `2px solid ${selected ? theme.palette.success.main : "transparent"}`,
    boxShadow: "none",
    "&:hover": {
      backgroundColor: selected
        ? `color-mix(in srgb, ${theme.palette.success.main} 16%, ${theme.palette.background.paper})`
        : theme.palette.action.hover,
    },
  });
}

interface RoleSegment {
  readonly value: CreateUserDialogRole;
  readonly label: string;
  readonly icon: ReactNode;
}

interface CreateUserRoleSegmentsProps {
  readonly labels: AdminUsersLabels;
  readonly value: CreateUserDialogRole;
  readonly onChange: (role: CreateUserDialogRole) => void;
}

/** Segmented role control — full width, first in the form. */
export function CreateUserRoleSegments({ labels, value, onChange }: CreateUserRoleSegmentsProps): ReactNode {
  // Segment labels: student/parent reuse the directory `roleLabels` block;
  // the teacher segment uses its dedicated applicant phrasing.
  const segments: readonly RoleSegment[] = [
    { value: "Student", label: labels.roleLabels.student, icon: <StudentIcon fontSize="small" /> },
    { value: "Parent", label: labels.roleLabels.parent, icon: <ParentIcon fontSize="small" /> },
    {
      value: "Teacher",
      label: labels.createDialog.roleSegments.teacherApplicant,
      icon: <TeacherApplicantIcon fontSize="small" />,
    },
  ];
  return (
    <Box>
      <AdminDialogFieldLabel id={CREATE_ROLE_LABEL_ID} text={labels.createDialog.role} />
      <Box
        aria-labelledby={CREATE_ROLE_LABEL_ID}
        sx={theme => ({
          display: "flex",
          gap: 0.5,
          p: 0.5,
          // Concentric with the 8px segment radius + 4px track inset (M3).
          borderRadius: "12px",
          backgroundColor: theme.palette.surfaceContainerHigh,
        })}
      >
        {segments.map(segment => (
          <Button
            key={segment.value}
            onClick={() => onChange(segment.value)}
            aria-pressed={value === segment.value}
            startIcon={segment.icon}
            sx={[
              roleSegmentSx(value === segment.value),
              {
                // Compact viewports stack icon over a wrapping label — the
                // "Teacher Applicant" phrase cannot fit a ~90px row segment
                // and silently clips; column composition keeps every locale's
                // full label readable. Row layout (sm+) is untouched.
                flexDirection: { xs: "column", sm: "row" },
                gap: { xs: 0.25, sm: 1 },
                fontSize: { xs: "0.75rem", sm: "0.875rem" },
                // Labels wrap at EVERY width (never nowrap): equal flex
                // lanes give long localized phrases (e.g. "Teacher
                // Applicant") zero headroom, and a nowrap label clips
                // mid-glyph at the segment's own border. Wrapping keeps
                // the full role name readable; wide lanes stay one line.
                whiteSpace: "normal",
                textAlign: "center",
                // 1.4 keeps a wrapped two-line label inside the 54px
                // segment floor (2 × 14px × 1.4 + 12px padding < 54px).
                lineHeight: { xs: 1.2, sm: 1.4 },
              },
            ]}
          >
            {segment.label}
          </Button>
        ))}
      </Box>
    </Box>
  );
}
