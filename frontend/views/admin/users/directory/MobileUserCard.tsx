"use client";

/**
 * MobileUserCard — one per-user card of the mobile directory list, composed
 * from the shared directory mobile-card primitives (`DirectoryMobileCard`
 * shell + `DirectoryMobileDetailRow` body rows):
 *  - header as a 3-track grid (`auto minmax(0,1fr) auto`): 44px role-tinted
 *    avatar, the NAME profile link (`MobileUserName`, truncating with the
 *    shared bidi ellipsis recipe), and a trailing column stacking the
 *    relative time caption above the kebab actions menu (the same menu the
 *    desktop table renders) — stacking keeps the name track ≥ ~180px wide
 *    at a 390px viewport, where a horizontal time+kebab row would not;
 *  - FULL-WIDTH email row + role pill (`MobileUserIdentity`) immediately
 *    BELOW the header grid (above the divider), inset at the logical 52px
 *    so the email aligns under the name column — the QA fix that stopped
 *    addresses wrapping mid-word inside the squeezed middle track;
 *  - hairline divider;
 *  - strict two-column body rows (label at inline-start in `text.secondary`,
 *    value flexing to the inline-end edge, 500 weight): Status (the per-role
 *    details headline) and Governance (bare dot + colored label — no pill on
 *    mobile).
 *
 * Soft-deleted users render dimmed via `MobileUserName`/`MobileUserIdentity`
 * and the body rows (`dimmed` drops the value cell to the disabled ink).
 */

import { Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryMobileCard } from "@/frontend/views/admin/directory-shared/DirectoryMobileCard";
import { DirectoryMobileDetailRow } from "@/frontend/views/admin/directory-shared/DirectoryMobileDetailRow";
import {
  DirectoryActionsMenu,
  DirectoryGovernanceLabel,
  DirectoryStatusDetails,
  type DirectoryUserItem,
  MobileUserIdentity,
  MobileUserName,
  type RowCellLabels,
} from "@/frontend/views/admin/users/directory";
import {
  asDirectoryRole,
  directoryGovernanceOf,
  formatDirectoryRelativeTime,
} from "@/frontend/views/admin/users/utils";

interface MobileUserCardProps {
  readonly labels: RowCellLabels;
  readonly user: DirectoryUserItem;
  readonly locale: "ar" | "en";
  readonly onEdit: (user: DirectoryUserItem) => void;
  readonly onChangePassword: (user: DirectoryUserItem) => void;
  readonly onDelete: (user: DirectoryUserItem) => void;
  /** Invoked after any card's copy-email action resolves (drives the snackbar). */
  readonly onCopyEmail?: () => void;
}

export function MobileUserCard({
  labels,
  user,
  locale,
  onEdit,
  onChangePassword,
  onDelete,
  onCopyEmail,
}: MobileUserCardProps): ReactNode {
  const role = asDirectoryRole(user.role);
  const deleted = user.isDeleted;
  return (
    <DirectoryMobileCard
      avatarName={user.fullName}
      avatarRole={role}
      name={<MobileUserName user={user} labels={labels} deleted={deleted} />}
      trailing={
        <>
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
            {formatDirectoryRelativeTime(user.lastActiveAt, locale)}
          </Typography>
          <DirectoryActionsMenu
            user={user}
            labels={labels}
            onEdit={onEdit}
            onChangePassword={onChangePassword}
            onDelete={onDelete}
          />
        </>
      }
      identity={
        <MobileUserIdentity user={user} role={role} labels={labels} deleted={deleted} onCopyEmail={onCopyEmail} />
      }
      rows={
        <>
          <DirectoryMobileDetailRow label={labels.headers.status} dimmed={deleted}>
            <DirectoryStatusDetails user={user} labels={labels} />
          </DirectoryMobileDetailRow>
          <DirectoryMobileDetailRow label={labels.headers.governance} dimmed={deleted}>
            <DirectoryGovernanceLabel governance={directoryGovernanceOf(user)} labels={labels} variant="dot-text" />
          </DirectoryMobileDetailRow>
        </>
      }
    />
  );
}
