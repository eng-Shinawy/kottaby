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
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { AdminDialogFieldLabel, type CreateUserDialogRole } from "@/frontend/views/admin/users/dialogs";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const CREATE_ROLE_LABEL_ID = "admin-users-create-role-label";

/** Segmented-role button styling — selected segment is an elevated paper
 *  pill with a 2px success border and a soft card shadow; unselected renders
 *  fully transparent inside the track (the transparent border keeps segment
 *  height stable across states). */
function roleSegmentSx(selected: boolean): SxProps<Theme> {
  return theme => ({
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: "8px",
    fontWeight: selected ? 600 : 500,
    color: selected ? theme.palette.success.main : theme.palette.text.secondary,
    backgroundColor: selected ? theme.palette.background.paper : "transparent",
    border: `2px solid ${selected ? theme.palette.success.main : "transparent"}`,
    boxShadow: selected ? theme.palette.shadow.card : "none",
    "&:hover": {
      backgroundColor: selected ? theme.palette.background.paper : theme.palette.action.hover,
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
          borderRadius: "10px",
          backgroundColor: theme.palette.surfaceContainerHigh,
        })}
      >
        {segments.map(segment => (
          <Button
            key={segment.value}
            onClick={() => onChange(segment.value)}
            aria-pressed={value === segment.value}
            startIcon={segment.icon}
            sx={roleSegmentSx(value === segment.value)}
          >
            {segment.label}
          </Button>
        ))}
      </Box>
    </Box>
  );
}
