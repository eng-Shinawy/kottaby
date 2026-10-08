import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useState } from "react";
import { type CreateUserDialogRole, CreateUserRoleSegments } from "@/frontend/views/admin/users/dialogs";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces";

/**
 * Storybook surface for `CreateUserRoleSegments` — the segmented role
 * control of the admin "create user" dialog. Rendered inside a frame that
 * mirrors the dialog's tinted body band (`surfaceContainerLowest` dark /
 * `surfaceContainer` light + the dialog gutter), so state borders and
 * hover tints are scored against the surface they actually sit on.
 *
 * The control is fully presentational (labels + value + onChange), so no
 * Apollo mocks are needed; labels flow through the real
 * `useAppTranslation(AdminUsers)` path and both locales render.
 */

interface RoleSegmentsHarnessProps {
  readonly initialRole: CreateUserDialogRole;
}

function RoleSegmentsHarness({ initialRole }: RoleSegmentsHarnessProps): ReactNode {
  const labels = useAppTranslation(AdminUsers);
  const [role, setRole] = useState<CreateUserDialogRole>(initialRole);
  return (
    <Box
      component="section"
      sx={theme => ({
        maxWidth: 520,
        m: 4,
        mx: "auto",
        p: 3,
        borderRadius: "16px",
        boxSizing: "border-box",
        backgroundColor:
          theme.palette.mode === "dark" ? theme.palette.surfaceContainerLowest : theme.palette.surfaceContainer,
      })}
    >
      <CreateUserRoleSegments labels={labels} value={role} onChange={setRole} />
    </Box>
  );
}

const meta = {
  title: "Admin/Create User Role Segments",
  component: RoleSegmentsHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["initialRole"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof RoleSegmentsHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Student segment selected (the dialog's default role). */
export const Default: Story = {
  args: { initialRole: "Student" },
};

/** Parent segment selected. */
export const ParentSelected: Story = {
  args: { initialRole: "Parent" },
};

/** Teacher-applicant segment selected — longest localized label. */
export const TeacherSelected: Story = {
  args: { initialRole: "Teacher" },
};
