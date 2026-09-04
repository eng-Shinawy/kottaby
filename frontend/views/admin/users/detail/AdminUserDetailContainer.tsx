"use client";

/**
 * AdminUserDetailContainer — the admin user detail client surface
 * (orchestration only).
 *
 * Queries, mutations, locale-bound formatters, and dialog/snackbar state
 * live in `useAdminUserDetail`; the loading / not-found branches live in
 * `userDetailStates` (`UserDetailLoading` / `UserDetailNotFound`); the
 * inline edit / delete-reactivate dialogs live in `UserDetailInlineDialogs`;
 * timestamp plumbing lives in `userDetailFormatters`.
 *
 * Renders the prototype structure: a back-to-directory link row, the
 * full-width `UserDetailHero` (identity + inline actions), then a 2-column
 * grid (24px gutters, single-column below `md`):
 *  - inline-start column (5/12): `ProfileInfoCard`, `GovernanceCard`;
 *  - inline-end column (7/12): the role card (`TeacherApplicationCard`,
 *    `StudentStatusCard`, or the slim parent card) + `RecentActivityCard`.
 *
 * The hero and cards carry INLINE mutations: Edit opens the shared
 * `EditUserDialog` (adminUpdateUser) and Deactivate/Reactivate opens the
 * shared `DeleteConfirmDialog` (adminSetUserDeleted) — the same dialogs the
 * directory uses. Post-write detail fragments merge into the Apollo cache
 * (`AdminUserDetail:<id>`, id-first) so this query re-renders without an
 * explicit refetch; the activity timeline refetches after each successful
 * inline mutation.
 *
 * A `USER_NOT_FOUND` response (stale link) renders a localized not-found
 * section with a back-to-directory CTA.
 */

import { ArrowBackOutlined as BackIcon, FamilyRestroomOutlined as ParentIcon } from "@mui/icons-material";
import { Box, Button, Link as MuiLink, Stack, Typography } from "@mui/material";
import {
  DetailCard,
  DetailCardTitle,
  DetailEyebrow,
  GovernanceCard,
  ProfileInfoCard,
  RecentActivityCard,
  StudentStatusCard,
  TeacherApplicationCard,
  UserDetailHero,
  UserDetailInlineDialogs,
  UserDetailLoading,
  UserDetailNotFound,
} from "@/frontend/views/admin/users/detail";
import { AdminUserSuccessSnackbar } from "@/frontend/views/admin/users/dialogs";
import { useAdminUserDetail } from "@/frontend/views/admin/users/hooks";
import { asDirectoryRole, directoryGovernanceOf } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface AdminUserDetailContainerProps {
  readonly labels: AdminUsersLabels;
  readonly userId: number;
}

export function AdminUserDetailContainer({ labels, userId }: AdminUserDetailContainerProps) {
  const detail = useAdminUserDetail(userId);

  if (detail.loading && !detail.data) {
    return <UserDetailLoading />;
  }

  if (detail.errorCode || !detail.data?.adminUserDetail) {
    return <UserDetailNotFound labels={labels} />;
  }

  const user = detail.data.adminUserDetail;
  // `user.role` is typed as `UserRole` (a string enum) by the codegen; the
  // runtime-validated `asDirectoryRole` helper narrows it to the directory
  // role union (no `as` cast).
  const role = asDirectoryRole(user.role);
  const governance = directoryGovernanceOf(user);

  return (
    <Stack spacing={3} sx={{ p: { xs: 2, md: 3 } }}>
      {/* Back link — the direction-flipped arrow keeps the chevron pointing
          "back" in RTL (logical-direction UI affordance, not text). */}
      <Box>
        <Button
          component={MuiLink}
          href="/admin/users"
          startIcon={<BackIcon sx={theme => ({ transform: theme.direction === "rtl" ? "scaleX(-1)" : "none" })} />}
          sx={{ minHeight: 44 }}
        >
          {labels.detail.backToDirectory}
        </Button>
      </Box>

      <UserDetailHero
        user={user}
        role={role}
        governance={governance}
        labels={labels}
        formatDate={detail.fmtDate}
        formatRelative={detail.fmtRelative}
        onEdit={detail.openEdit}
        onDelete={detail.openDelete}
        onCertify={() => detail.setCertifyTarget({ id: user.id, fullName: user.fullName, email: user.email })}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "5fr 7fr" },
          gap: 3,
          // stretch (not start): the narrow column grows to the wide column's
          // height so GovernanceCard's flexGrow can absorb the trailing void.
          alignItems: "stretch",
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0, height: "100%" }}>
          <ProfileInfoCard user={user} labels={labels} formatDate={detail.fmtDate} onEdit={detail.openEdit} />
          <GovernanceCard user={user} governance={governance} labels={labels} formatTimestamp={detail.fmtTimestamp} />
        </Stack>

        <Stack spacing={3} sx={{ minWidth: 0, height: "100%" }}>
          {(user.applicant ?? user.teacher) && (
            <TeacherApplicationCard user={user} labels={labels} formatDate={detail.fmtDate} />
          )}
          {user.student && <StudentStatusCard student={user.student} labels={labels} />}
          {user.parent && (
            <DetailCard>
              <DetailCardTitle icon={<ParentIcon />} title={labels.detail.parent} />
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <DetailEyebrow>{labels.detail.parentFields.linkedChildrenCount}</DetailEyebrow>
                <Typography variant="body2" sx={theme => ({ fontWeight: 500, color: theme.palette.text.primary })}>
                  {user.parent.linkedChildrenCount}
                </Typography>
              </Box>
            </DetailCard>
          )}
          <RecentActivityCard
            labels={labels}
            activityLoading={detail.activityLoading}
            activityData={detail.activityData}
            activityError={detail.activityError}
            formatRelative={detail.fmtRelative}
          />
        </Stack>
      </Box>

      <UserDetailInlineDialogs labels={labels} user={user} detail={detail} />

      <AdminUserSuccessSnackbar message={detail.snackbarMessage} onClose={() => detail.setSnackbarMessage(null)} />
    </Stack>
  );
}
