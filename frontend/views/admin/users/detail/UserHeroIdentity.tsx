"use client";

/**
 * UserHeroIdentity — the identity cluster of the admin user DETAIL hero
 * (`UserDetailHero`), extracted from `UserDetailHero.tsx`.
 *
 * Name + chips + contact + meta as ONE tight, start-aligned stack (~560px
 * cap, 8px/12px vertical rhythm) — no wide flex band; the actions column
 * pins to the logical end via `marginInlineStart: "auto"` on the trailing
 * `UserHeroActions` stack.
 *
 *  - Chips: `DirectoryRolePill`, then — when an applicant snapshot exists —
 *    the tonal `ApplicantStatusChip`, then the `DirectoryGovernanceLabel`
 *    (pill variant). This is the ONE place governance status renders as a
 *    chip on the page (the governance card renders the dot-label; the
 *    profile card carries no status at all — the 3× duplication defect is
 *    gone).
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
 */

import {
  EmailOutlined as EmailIcon,
  LocationOnOutlined as LocationIcon,
  PhoneOutlined as PhoneIcon,
} from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUserDetailQuery_adminUserDetail } from "@/frontend/graphql/generated/gql/graphql";
import { DirectoryGovernanceLabel, DirectoryRolePill } from "@/frontend/views/admin/users/directory";
import { ApplicantStatusChip } from "@/frontend/views/admin/users/ui";
import type { DirectoryGovernance, DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DetailUser = AdminUserDetailQuery_adminUserDetail;

interface ContactItemProps {
  readonly icon: ReactNode;
  readonly value: string;
  /** Email/phone are LTR data — isolate them so RTL layout never reorders the glyphs. */
  readonly ltr: boolean;
  /** Ellipsize long values (email) with the full value exposed via `title`. */
  readonly truncate: boolean;
}

function ContactItem({ icon, value, ltr, truncate }: ContactItemProps): ReactNode {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      <Box
        aria-hidden
        sx={theme => ({
          display: "inline-flex",
          flexShrink: 0,
          color: theme.palette.text.secondary,
          "& > svg": { fontSize: 18 },
        })}
      >
        {icon}
      </Box>
      <Typography
        variant="body2"
        component="span"
        dir={ltr ? "ltr" : undefined}
        title={truncate ? value : undefined}
        sx={theme => ({
          color: theme.palette.text.secondary,
          ...(ltr && { unicodeBidi: "isolate" }),
          ...(truncate && {
            maxWidth: { xs: 240, sm: 320 },
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }),
        })}
      >
        {value}
      </Typography>
    </Box>
  );
}

interface UserHeroIdentityProps {
  readonly user: DetailUser;
  readonly role: DirectoryRole;
  readonly governance: DirectoryGovernance;
  readonly labels: Pick<AdminUsersLabels, "roleLabels" | "statusBadges" | "detail">;
  readonly isDeleted: boolean;
  /** Locale-bound date-only formatter (`Intl.DateTimeFormat(dateStyle: "medium")`). */
  readonly formatDate: (raw: string | null | undefined) => string;
  /** Locale-bound relative-time formatter (`Intl.RelativeTimeFormat` ladder). */
  readonly formatRelative: (raw: string | null | undefined) => string;
}

export function UserHeroIdentity({
  user,
  role,
  governance,
  labels,
  isDeleted,
  formatDate,
  formatRelative,
}: UserHeroIdentityProps): ReactNode {
  return (
    <Box sx={{ minWidth: 0, maxWidth: { md: 560 } }}>
      <Typography
        variant="h5"
        component="h1"
        sx={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {user.fullName}
      </Typography>
      <Stack direction="row" sx={{ mt: 1, gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        <DirectoryRolePill role={role} labels={labels} muted={isDeleted} />
        {user.applicant && (
          <ApplicantStatusChip status={user.applicant.status} labels={labels.detail.applicantStatus} />
        )}
        <DirectoryGovernanceLabel governance={governance} labels={labels} />
      </Stack>
      <Stack direction="row" sx={{ mt: 1.5, gap: 3, flexWrap: "wrap", alignItems: "center" }}>
        <ContactItem icon={<EmailIcon />} value={user.email} ltr truncate />
        {user.phone && <ContactItem icon={<PhoneIcon />} value={user.phone} ltr truncate={false} />}
        {user.country && <ContactItem icon={<LocationIcon />} value={user.country} ltr={false} truncate={false} />}
      </Stack>
      <Stack direction="row" sx={{ mt: 1, gap: 3, flexWrap: "wrap", alignItems: "center" }}>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {labels.detail.memberSince}: {formatDate(user.createdAt)}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {labels.detail.lastActiveLabel}:{" "}
          <Box component="span" sx={theme => ({ color: theme.palette.onSuccessContainer, fontWeight: 600 })}>
            {formatRelative(user.lastActiveAt)}
          </Box>
        </Typography>
      </Stack>
    </Box>
  );
}
