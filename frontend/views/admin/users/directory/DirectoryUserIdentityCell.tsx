"use client";

/**
 * DirectoryUserIdentityCell — the desktop table's USER column: avatar +
 * name link + ellipsized email + copy-email quick action.
 *
 * Bidi note (Latin names/emails inside an RTL page): the HTML `dir="ltr"`
 * ATTRIBUTE isolates glyph direction and participates in the bidi
 * algorithm. A CSS `direction: "ltr"` rule MUST NOT be added —
 * stylis-plugin-rtl flips it to `rtl` and it would override the attribute,
 * clipping the START of the text (leading ellipsis). With the attribute
 * alone, direction stays `ltr` and `text-align: start` shows the head with
 * a trailing ellipsis.
 *
 * The copy affordance writes the email to the clipboard and reports
 * success through `onCopyEmail` (the container owns the shared success
 * snackbar); clipboard failures are silently dropped so the snackbar never
 * lies about a copy that did not happen.
 */

import { Box, Stack, TableCell, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryCopyEmailButton } from "@/frontend/views/admin/directory-shared/DirectoryCopyEmailButton";
import { DirectoryNameLink } from "@/frontend/views/admin/directory-shared/DirectoryNameLink";
import { type DirectoryUserItem, useDirectoryCopyEmail } from "@/frontend/views/admin/users/directory";
import { UserAvatar } from "@/frontend/views/admin/users/ui";
import type { DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryUserIdentityCellProps {
  readonly user: DirectoryUserItem;
  readonly role: DirectoryRole;
  readonly labels: Pick<AdminUsersLabels, "quickActions">;
  /** Invoked after the email copy resolves successfully (drives the snackbar). */
  readonly onCopyEmail?: () => void;
}

export function DirectoryUserIdentityCell({
  user,
  role,
  labels,
  onCopyEmail,
}: DirectoryUserIdentityCellProps): ReactNode {
  const { emailCopied, handleCopyEmail } = useDirectoryCopyEmail(user.email, onCopyEmail);
  return (
    <TableCell sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
        <UserAvatar fullName={user.fullName} role={role} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <DirectoryNameLink
            href={`/admin/users/${user.id}`}
            name={user.fullName}
            viewProfileLabel={labels.quickActions.viewProfile}
          />
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
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
                flex: 1,
                minWidth: 0,
              })}
            >
              {user.email}
            </Typography>
            <DirectoryCopyEmailButton
              email={user.email}
              copied={emailCopied}
              copyLabel={labels.quickActions.copyEmail}
              copiedLabel={labels.quickActions.emailCopied}
              onCopy={handleCopyEmail}
            />
          </Stack>
        </Box>
      </Stack>
    </TableCell>
  );
}
