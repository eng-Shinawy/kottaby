"use client";

/**
 * ProfileInfoCard — the read-only profile facts card of the admin user
 * DETAIL page (prototype's "Profile Information" card).
 *
 * Fixes two defects of the legacy card:
 *  - values now sit in a flush column (label column fixed at 40% of the row)
 *    instead of center-aligned mixed alignment;
 *  - rows are separated by `divider` hairlines, with a DASHED divider
 *    opening the system-timestamp group (Created At).
 *
 * Email renders with the HTML `dir="ltr"` attribute + `unicodeBidi: isolate`
 * (CSS `direction` gets flipped by stylis-plugin-rtl in RTL mode — the attr is
 * the only reliable pin) and ellipsizes with the full value in `title`; phone
 * uses the same treatment.
 * A trailing edit IconButton opens the same edit dialog the hero button
 * opens. Footer: tinted strip with the localized read-only note.
 *
 * NOTE: the prototype also shows an "Updated At" row, but the
 * `adminUsers` locale namespace has no label for it — omitted until the
 * namespace gains a key (locale types are owned by another stream; nothing
 * here is hardcoded).
 */

import { EditOutlined as EditIcon } from "@mui/icons-material";
import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { type AdminUserDetailQuery_adminUserDetail, Gender } from "@/frontend/graphql/generated/gql/graphql";
import { DetailCard, DetailInfoStrip } from "@/frontend/views/admin/users/detail";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DetailUser = AdminUserDetailQuery_adminUserDetail;
type ProfileLabels = Pick<AdminUsersLabels, "headers" | "genderOptions" | "createDialog" | "editDialog" | "detail">;

interface ProfileInfoCardProps {
  readonly user: DetailUser;
  readonly labels: ProfileLabels;
  /** Locale-bound date-only formatter (calendar `dateOfBirth` + timestamps). */
  readonly formatDate: (raw: string | null | undefined) => string;
  readonly onEdit: () => void;
}

/** Localized gender label; the unset placeholder when null. */
function genderLabel(gender: Gender | null, labels: ProfileLabels): string {
  if (gender === null) return labels.detail.emptyValue;
  const genderLabels: Record<Gender, string> = {
    [Gender.Male]: labels.genderOptions.male,
    [Gender.Female]: labels.genderOptions.female,
    [Gender.Other]: labels.genderOptions.other,
  };
  return genderLabels[gender];
}

interface ProfileRowProps {
  readonly label: string;
  /** `solid` (default after the first row) or `dashed` (before system timestamps). */
  readonly borderStyle: "none" | "solid" | "dashed";
  /** Email/phone are LTR data — pinned via the HTML `dir` attribute so stylis-plugin-rtl cannot flip them. */
  readonly ltr?: boolean;
  /** Ellipsize with the full value in `title` (long emails). */
  readonly truncate?: boolean;
  readonly children: string;
}

function ProfileRow({ label, borderStyle, ltr = false, truncate = false, children }: ProfileRowProps): ReactNode {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={theme => ({
        py: 1.25,
        alignItems: "center",
        ...(borderStyle === "solid" && { borderTop: `1px solid ${theme.palette.divider}` }),
        ...(borderStyle === "dashed" && { borderTop: `1px dashed ${theme.palette.divider}` }),
      })}
    >
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.secondary, flexBasis: "40%", flexShrink: 0, minWidth: 0 })}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        title={truncate ? children : undefined}
        {...(ltr ? { dir: "ltr" } : {})}
        sx={theme => ({
          flex: 1,
          minWidth: 0,
          fontWeight: 500,
          textAlign: "start",
          color: theme.palette.text.primary,
          ...(ltr && { unicodeBidi: "isolate" }),
          ...(truncate && { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
        })}
      >
        {children}
      </Typography>
    </Stack>
  );
}

export function ProfileInfoCard({ user, labels, formatDate, onEdit }: ProfileInfoCardProps): ReactNode {
  return (
    <DetailCard>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, fontSize: 17 }}>
          {labels.detail.profile}
        </Typography>
        <Tooltip title={labels.detail.editAction}>
          <IconButton
            aria-label={labels.detail.editAction}
            onClick={onEdit}
            sx={theme => ({ minWidth: 44, minHeight: 44, color: theme.palette.primary.main })}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box>
        <ProfileRow label={labels.headers.name} borderStyle="none">
          {user.fullName}
        </ProfileRow>
        <ProfileRow label={labels.headers.email} borderStyle="solid" ltr truncate>
          {user.email}
        </ProfileRow>
        <ProfileRow label={labels.headers.phone} borderStyle="solid" ltr>
          {user.phone ?? labels.detail.emptyValue}
        </ProfileRow>
        <ProfileRow label={labels.headers.country} borderStyle="solid">
          {user.country ?? labels.detail.emptyValue}
        </ProfileRow>
        <ProfileRow label={labels.createDialog.gender} borderStyle="solid">
          {genderLabel(user.gender, labels)}
        </ProfileRow>
        <ProfileRow label={labels.editDialog.dateOfBirth} borderStyle="solid">
          {formatDate(user.dateOfBirth)}
        </ProfileRow>
        <ProfileRow label={labels.headers.createdAt} borderStyle="dashed">
          {formatDate(user.createdAt)}
        </ProfileRow>
      </Box>
      <DetailInfoStrip note={labels.detail.profileReadonlyNote} />
    </DetailCard>
  );
}
