"use client";

/**
 * DirectoryUserRow — one body row of the desktop `DirectoryTable`:
 * identity (avatar/name/email + copy-email quick action), phone, role pill,
 * status/details headline, governance pill, relative "last active", and the
 * kebab actions menu.
 *
 * The row enforces the 72px body-row height on the CELLS (a row's own
 * height is a minimum; `py: 1.5` alone measured short once line-heights
 * settled). `verticalAlign: middle` keeps single-line cells centered within
 * the 72px band. Even rows carry a faint zebra tint (`action.hover`); hover
 * upgrades the whole row to `action.selected` so the pointer position stays
 * visually distinct from the static stripe rhythm.
 */

import { Box, TableCell, Typography } from "@mui/material";
import { memo, type ReactNode } from "react";
import { DirectoryBodyRow } from "@/frontend/views/admin/directory-shared/DirectoryBodyRow";
import {
  DirectoryActionsMenu,
  DirectoryGovernanceLabel,
  DirectoryRelativeTime,
  DirectoryRolePill,
  DirectoryStatusDetails,
  DirectoryUserIdentityCell,
  type DirectoryUserItem,
  type RowCellLabels,
} from "@/frontend/views/admin/users/directory";
import { asDirectoryRole, directoryGovernanceOf } from "@/frontend/views/admin/users/utils";

interface DirectoryUserRowProps {
  readonly user: DirectoryUserItem;
  readonly labels: RowCellLabels;
  readonly locale: "ar" | "en";
  /** `true` paints the faint zebra tint on this row (odd body-row index). */
  readonly striped?: boolean;
  readonly onEdit: (user: DirectoryUserItem) => void;
  readonly onChangePassword: (user: DirectoryUserItem) => void;
  readonly onDelete: (user: DirectoryUserItem) => void;
  /** Invoked after the identity cell's copy-email action resolves. */
  readonly onCopyEmail?: () => void;
}

export const DirectoryUserRow = memo(function DirectoryUserRow({
  user,
  labels,
  locale,
  striped,
  onEdit,
  onChangePassword,
  onDelete,
  onCopyEmail,
}: DirectoryUserRowProps): ReactNode {
  const role = asDirectoryRole(user.role);
  return (
    <DirectoryBodyRow striped={striped}>
      <DirectoryUserIdentityCell user={user} role={role} labels={labels} onCopyEmail={onCopyEmail} />
      <TableCell sx={{ minWidth: 0 }}>
        {user.phone ? (
          // Phone numbers are LTR by nature; a CSS-only `direction`
          // on an inline element still lets the surrounding RTL
          // paragraph reorder the leading `+` to the visual end,
          // so the digits live inside a dedicated block-level span
          // carrying the HTML `dir="ltr"` ATTRIBUTE plus bidi
          // isolation (the attribute participates in the bidi
          // algorithm; CSS alone does not, per spec, when the
          // ancestor embedding context flips).
          <Box
            component="span"
            dir="ltr"
            sx={{
              display: "block",
              unicodeBidi: "isolate",
              textAlign: "start",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <Typography variant="body2" component="span" sx={theme => ({ color: theme.palette.text.primary })}>
              {user.phone}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            —
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <DirectoryRolePill role={role} labels={labels} muted={user.isDeleted} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <DirectoryStatusDetails user={user} labels={labels} />
      </TableCell>
      <TableCell>
        <DirectoryGovernanceLabel governance={directoryGovernanceOf(user)} labels={labels} />
      </TableCell>
      <TableCell sx={{ minWidth: 0 }}>
        <DirectoryRelativeTime value={user.lastActiveAt} locale={locale} />
      </TableCell>
      <TableCell sx={theme => ({ textAlign: "end", color: theme.palette.text.secondary, paddingInlineEnd: 3 })}>
        <DirectoryActionsMenu
          user={user}
          labels={labels}
          onEdit={onEdit}
          onChangePassword={onChangePassword}
          onDelete={onDelete}
        />
      </TableCell>
    </DirectoryBodyRow>
  );
});
