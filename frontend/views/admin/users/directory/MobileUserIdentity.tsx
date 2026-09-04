"use client";

/**
 * MobileUserIdentity — the mobile user card's middle header track: name
 * link + full-width wrapping email + role pill.
 *
 * The email WRAPS (no ellipsis): at a 375px viewport the identity track is
 * ~200px wide, so nowrap + ellipsis hid a further ~27px of every seeded
 * address; wrapping shows the whole value across two lines instead of
 * silently cutting it. The name link keeps its single-line ellipsis (names
 * are short) and carries the shared 44px tap-target padding.
 *
 * Bidi note (Latin names/emails inside an RTL page): the HTML `dir="ltr"`
 * ATTRIBUTE isolates glyph direction. A CSS `direction` rule MUST NOT be
 * added — stylis-plugin-rtl would flip it to `rtl`, clipping the string's
 * head. With the attribute alone plus `unicodeBidi: "isolate"`,
 * `text-align: start` reads correctly in both directions.
 *
 * Soft-deleted users render dimmed: the name/email drop to the disabled
 * ink, the name is struck through, and the role pill falls back to the
 * neutral lane.
 */

import { Box, Link as MuiLink, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { DirectoryRolePill, type DirectoryUserItem } from "@/frontend/views/admin/users/directory";
import type { DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface MobileUserIdentityProps {
  readonly user: DirectoryUserItem;
  readonly role: DirectoryRole;
  readonly labels: Pick<AdminUsersLabels, "quickActions" | "roleLabels">;
  readonly deleted: boolean;
}

export function MobileUserIdentity({ user, role, labels, deleted }: MobileUserIdentityProps): ReactNode {
  return (
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
          unicodeBidi: "isolate",
          textAlign: "start",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          color: deleted ? theme.palette.text.disabled : theme.palette.text.primary,
          // ≥44px tap target without shifting the email below: transparent
          // block padding grows the clickable box while the matching
          // negative margins keep the layout height unchanged.
          minHeight: 44,
          paddingBlock: "10.5px",
          marginBlock: "-10.5px",
          ...(deleted && { textDecoration: "line-through" }),
        })}
      >
        {user.fullName}
      </MuiLink>
      <Typography
        variant="body2"
        dir="ltr"
        sx={theme => ({
          display: "block",
          fontSize: 13,
          unicodeBidi: "isolate",
          textAlign: "start",
          // Wrap long addresses instead of ellipsizing them — a truncated
          // email defeats the card's purpose (the full value at a glance).
          overflowWrap: "anywhere",
          minWidth: 0,
          color: deleted ? theme.palette.text.disabled : theme.palette.text.secondary,
        })}
      >
        {user.email}
      </Typography>
      <Box sx={{ mt: 0.5 }}>
        <DirectoryRolePill role={role} labels={labels} muted={deleted} />
      </Box>
    </Box>
  );
}
