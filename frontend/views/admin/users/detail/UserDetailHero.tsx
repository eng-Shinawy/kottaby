"use client";

/**
 * UserDetailHero — the full-width identity header of the admin user DETAIL
 * page (prototype `user-detail-*.png` hero card).
 *
 * Composition (single card, radius 12, `border.light`, `shadow.card`):
 *  - 96px role-tinted `UserAvatar` + name (xl/700, single-line ellipsis).
 *  - The identity cluster (name + chip row + contact row + meta row) lives
 *    in `UserHeroIdentity`; the trailing action buttons (Edit /
 *    Deactivate-or-Reactivate) live in `UserHeroActions`.
 *  - Chip row: `DirectoryRolePill`, then — when an applicant snapshot
 *    exists — the tonal `ApplicantStatusChip`, then the
 *    `DirectoryGovernanceLabel` (pill variant). This is the ONE place
 *    governance status renders as a chip on the page (the governance card
 *    renders the dot-label; the profile card carries no status at all — the
 *    3× duplication defect is gone).
 *  - Contact row (EmailOutlined / PhoneOutlined / LocationOnOutlined,
 *    `text.secondary`). Email + phone pin LTR via the HTML `dir="ltr"`
 *    ATTRIBUTE + `unicodeBidi: isolate` (NOT a CSS `direction` declaration —
 *    the Arabic Emotion cache runs `stylis-plugin-rtl`, which flips author
 *    `direction: ltr` declarations to `rtl`; the `dir` attribute is applied
 *    by the user-agent stylesheet and survives). The email also ellipsizes
 *    with a `title` tooltip for long journey-fixture addresses.
 *
 *    Same technique as `frontend/views/students/dashboard/HandshakeCodeCard.tsx`.
 *  - Meta row: "Member Since: <createdAt>" + "Last Active: <relative>", the
 *    relative part painted in the success family (prototype's mint accent).
 *  - Trailing actions: Certify (outlined `warning` → cold-start certify
 *    dialog, gated on role Teacher + applicant snapshot + not-yet-approved
 *    teacher + ungoverned account), Edit (contained `primary` → existing
 *    edit dialog) and Deactivate (outlined `error` → existing delete
 *    dialog); for deleted users the slot renders Reactivate instead.
 *  - Optional flourish: a skewed alpha-primary wash clipped to the card's
 *    trailing edge (decorative, `aria-hidden`, behind content). The wash
 *    lives inside a full-bleed clipping wrapper so its skew can never
 *    widen the card's scrollable overflow (the card reports no hidden
 *    horizontal overflow at any viewport).
 *
 * Directional CSS uses logical properties only (`insetInlineEnd`), so the
 * wash and rows mirror correctly under RTL.
 */

import { Box, Stack } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminUserDetailQuery_adminUserDetail } from "@/frontend/graphql/generated/gql/graphql";
import { UserHeroActions, UserHeroIdentity } from "@/frontend/views/admin/users/detail";
import { UserAvatar } from "@/frontend/views/admin/users/ui";
import type { DirectoryGovernance, DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DetailUser = AdminUserDetailQuery_adminUserDetail;

interface UserDetailHeroProps {
  readonly user: DetailUser;
  readonly role: DirectoryRole;
  readonly governance: DirectoryGovernance;
  readonly labels: Pick<AdminUsersLabels, "roleLabels" | "statusBadges" | "detail" | "certifyDialog">;
  /** Locale-bound date-only formatter (`Intl.DateTimeFormat(dateStyle: "medium")`). */
  readonly formatDate: (raw: string | null | undefined) => string;
  /** Locale-bound relative-time formatter (`Intl.RelativeTimeFormat` ladder). */
  readonly formatRelative: (raw: string | null | undefined) => string;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onCertify: () => void;
}

export function UserDetailHero({
  user,
  role,
  governance,
  labels,
  formatDate,
  formatRelative,
  onEdit,
  onDelete,
  onCertify,
}: UserDetailHeroProps): ReactNode {
  const isDeleted = user.isDeleted ?? false;
  return (
    <Box
      sx={theme => ({
        position: "relative",
        overflow: "hidden",
        p: { xs: 2, md: 3 },
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        bgcolor: theme.palette.background.paper,
      })}
    >
      {/* Decorative slanted alpha-primary wash at the card's trailing edge,
          painted as a hard-stop gradient on a full-bleed layer. Painting the
          flourish (instead of positioning a skewed child) keeps every painted
          pixel inside the card box, so the card reports no hidden horizontal
          overflow at any viewport; the angle mirrors per direction. */}
      <Box
        aria-hidden
        sx={theme => ({
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `linear-gradient(${
            theme.direction === "rtl" ? "254deg" : "106deg"
          }, transparent 0%, transparent 72%, ${alpha(theme.palette.primary.main, 0.06)} 72%, ${alpha(
            theme.palette.primary.main,
            0.06
          )} 100%)`,
        })}
      />
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={3}
        sx={{ position: "relative", alignItems: { xs: "flex-start", md: "center" } }}
      >
        <UserAvatar fullName={user.fullName} role={role} size={96} />
        <UserHeroIdentity
          user={user}
          role={role}
          governance={governance}
          labels={labels}
          isDeleted={isDeleted}
          formatDate={formatDate}
          formatRelative={formatRelative}
        />
        <UserHeroActions labels={labels} user={user} onEdit={onEdit} onDelete={onDelete} onCertify={onCertify} />
      </Stack>
    </Box>
  );
}
