"use client";

/**
 * DirectoryUserRow — one body row of the desktop `DirectoryTable`:
 * identity (avatar/name/email), phone, role pill, status/details headline,
 * governance pill, relative "last active", and the kebab actions menu.
 *
 * The row enforces the 72px body-row height on the CELLS (a row's own
 * height is a minimum; `py: 1.5` alone measured short once line-heights
 * settled). `verticalAlign: middle` keeps single-line cells centered within
 * the 72px band.
 */

import { Box, TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
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
  readonly onEdit: (user: DirectoryUserItem) => void;
  readonly onDelete: (user: DirectoryUserItem) => void;
}

export function DirectoryUserRow({ user, labels, locale, onEdit, onDelete }: DirectoryUserRowProps): ReactNode {
  const role = asDirectoryRole(user.role);
  return (
    <TableRow
      sx={theme => ({
        height: 72,
        "& td": {
          height: 72,
          py: 1.5,
          verticalAlign: "middle",
          borderBottom: `1px solid ${theme.palette.border.light}`,
        },
        "&:last-child td": { borderBottom: 0 },
        "&:hover": { bgcolor: theme.palette.action.hover },
      })}
    >
      <DirectoryUserIdentityCell user={user} role={role} labels={labels} />
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
        <DirectoryActionsMenu user={user} labels={labels} onEdit={onEdit} onDelete={onDelete} />
      </TableCell>
    </TableRow>
  );
}
