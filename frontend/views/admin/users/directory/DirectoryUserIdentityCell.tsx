"use client";

/**
 * DirectoryUserIdentityCell — the desktop table's USER column: avatar +
 * name link + ellipsized email.
 *
 * Bidi note (Latin names/emails inside an RTL page): the HTML `dir="ltr"`
 * ATTRIBUTE isolates glyph direction and participates in the bidi
 * algorithm. A CSS `direction: "ltr"` rule MUST NOT be added —
 * stylis-plugin-rtl flips it to `rtl` and it would override the attribute,
 * clipping the START of the text (leading ellipsis). With the attribute
 * alone, direction stays `ltr` and `text-align: start` shows the head with
 * a trailing ellipsis.
 */

import { Box, Link as MuiLink, Stack, TableCell, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import type { DirectoryUserItem } from "@/frontend/views/admin/users/directory";
import { UserAvatar } from "@/frontend/views/admin/users/ui";
import type { DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryUserIdentityCellProps {
  readonly user: DirectoryUserItem;
  readonly role: DirectoryRole;
  readonly labels: Pick<AdminUsersLabels, "quickActions">;
}

export function DirectoryUserIdentityCell({ user, role, labels }: DirectoryUserIdentityCellProps): ReactNode {
  return (
    <TableCell sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
        <UserAvatar fullName={user.fullName} role={role} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <MuiLink
            component={Link}
            href={`/admin/users/${user.id}`}
            underline="hover"
            aria-label={`${labels.quickActions.viewProfile}: ${user.fullName}`}
            title={user.fullName}
            dir="ltr"
            sx={theme => ({
              display: "block",
              maxWidth: "100%",
              fontSize: 15,
              fontWeight: 600,
              color: theme.palette.text.primary,
              unicodeBidi: "isolate",
              textAlign: "start",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              // ≥44px tap target without changing the row's visual density:
              // transparent block padding grows the clickable box while the
              // matching negative margins keep the layout height unchanged.
              minHeight: 44,
              paddingBlock: "10.5px",
              marginBlock: "-10.5px",
            })}
          >
            {user.fullName}
          </MuiLink>
          <Typography
            variant="body2"
            title={user.email}
            dir="ltr"
            sx={theme => ({
              fontSize: 13,
              color: theme.palette.text.secondary,
              unicodeBidi: "isolate",
              textAlign: "start",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
              minWidth: 0,
            })}
          >
            {user.email}
          </Typography>
        </Box>
      </Stack>
    </TableCell>
  );
}
