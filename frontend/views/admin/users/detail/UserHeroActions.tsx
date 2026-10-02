"use client";

/**
 * UserHeroActions — the trailing action buttons of the admin user DETAIL
 * hero (`UserDetailHero`), extracted from `UserDetailHero.tsx`.
 *
 * Edit (contained `primary` → the shared edit dialog), Change password
 * (outlined, neutral ink → the shared credential dialog), and Deactivate
 * (outlined `error` → the shared delete dialog); for deleted users the slot
 * renders Reactivate (outlined `success`) instead and the Change password
 * button is HIDDEN — `adminSetUserPassword` denies deleted targets ("no
 * live credential to replace"), so the affordance collapses instead of
 * sending the admin through a doomed round-trip. Uncertified teacher
 * applicants additionally get the Certify button (outlined `warning` → the
 * cold-start `CertifyTeacherDialog`), gated on: role Teacher, an applicant
 * snapshot present, the teacher snapshot NOT approved, and the account not
 * deleted / blocked / suspended.
 */

import {
  BlockOutlined as BlockIcon,
  WorkspacePremiumOutlined as CertifyIcon,
  EditOutlined as EditIcon,
  KeyOutlined as KeyIcon,
  RefreshOutlined as ReactivateIcon,
} from "@mui/icons-material";
import { Button, Stack } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { type AdminUserDetailQuery_adminUserDetail, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface UserHeroActionsProps {
  readonly labels: Pick<AdminUsersLabels, "detail" | "certifyDialog" | "changePasswordAction">;
  readonly user: AdminUserDetailQuery_adminUserDetail;
  readonly onEdit: () => void;
  readonly onChangePassword: () => void;
  readonly onDelete: () => void;
  readonly onCertify: () => void;
}

export function UserHeroActions({
  labels,
  user,
  onEdit,
  onChangePassword,
  onDelete,
  onCertify,
}: UserHeroActionsProps): ReactNode {
  const isDeleted = user.isDeleted ?? false;
  // The Certify slot mirrors the backend mutation's guard rails: role Teacher
  // + an applicant snapshot + not yet approved + the account not governed
  // (deleted / blocked / suspended).
  const isGoverned = isDeleted || (user.isBlocked ?? false) || (user.suspended ?? false);
  const showCertify =
    user.role === UserRole.Teacher && user.applicant !== null && user.teacher?.isApproved !== true && !isGoverned;
  return (
    <Stack spacing={1.5} sx={{ flexShrink: 0, marginInlineStart: { md: "auto" } }}>
      {showCertify && (
        <Button
          variant="outlined"
          color="warning"
          startIcon={<CertifyIcon />}
          onClick={onCertify}
          sx={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: 168 }}
        >
          {labels.certifyDialog.title}
        </Button>
      )}
      <Button
        variant="contained"
        color="primary"
        startIcon={<EditIcon />}
        onClick={onEdit}
        sx={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: 168, minHeight: 54 }}
      >
        {labels.detail.editAction}
      </Button>
      {/* adminSetUserPassword rejects deleted targets (USER_NOT_FOUND — no
          live credential to replace), so the affordance collapses like the
          Certify slot's governance gate instead of inviting a doomed submit. */}
      {!isDeleted && (
        <Button
          variant="outlined"
          startIcon={<KeyIcon />}
          onClick={onChangePassword}
          sx={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: 168, minHeight: 54 }}
        >
          {labels.changePasswordAction}
        </Button>
      )}
      {isDeleted ? (
        <Button
          variant="outlined"
          color="success"
          startIcon={<ReactivateIcon />}
          onClick={onDelete}
          sx={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: 168, minHeight: 54 }}
        >
          {labels.detail.reactivateAction}
        </Button>
      ) : (
        <Button
          variant="outlined"
          color="error"
          startIcon={<BlockIcon />}
          onClick={onDelete}
          sx={theme => ({
            whiteSpace: "nowrap",
            flexShrink: 0,
            minWidth: 168,
            minHeight: 54,
            "&:not(:disabled)": {
              bgcolor: alpha(theme.palette.error.main, 0.08),
              "&:hover": { bgcolor: alpha(theme.palette.error.main, 0.12) },
            },
          })}
        >
          {labels.detail.deleteAction}
        </Button>
      )}
    </Stack>
  );
}
