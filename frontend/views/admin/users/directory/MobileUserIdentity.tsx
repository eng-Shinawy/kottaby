"use client";

/**
 * MobileUserIdentity — the admin users mobile card's identity pieces, split
 * around the QA-verified full-width email fix:
 *
 *  - `MobileUserName` — the NAME profile link that occupies the middle track
 *    of the card's 3-track header grid (`auto minmax(0,1fr) auto`). It keeps
 *    the shared single-line ellipsis recipe (names are short) and the 44px
 *    tap-target padding (transparent block padding + matching negative
 *    margins, so the clickable box grows without shifting the layout).
 *
 *  - `MobileUserIdentity` — the FULL-WIDTH identity rows rendered
 *    immediately BELOW the header grid (above the divider): the email +
 *    copy-email quick action row, then the role pill. Layout rationale (QA
 *    fix): the old placement inside the header grid's middle track squeezed
 *    addresses into ~200px and wrapped them mid-word into ragged lines —
 *    the email row now spans the whole card and is inset with the LOGICAL
 *    `paddingInlineStart: "52px"` (44px avatar + 8px grid gap) so the email
 *    aligns under the name column; the inset flips correctly under RTL. At
 *    ~full card width even seeded addresses fit one line, with
 *    `overflowWrap: "anywhere"` as the pathological-address fallback. The
 *    email WRAPS (no ellipsis): nowrap + ellipsis silently cut every seeded
 *    address, and a truncated email defeats the card's purpose (the full
 *    value at a glance). The role pill keeps its place in the identity
 *    area — under the email row, indented at the same 52px inset (visually
 *    consistent with its old middle-track position).
 *
 * The copy affordance (parity with the desktop identity cell) writes the
 * email to the clipboard and reports success through `onCopyEmail` (the
 * container owns the shared success snackbar); clipboard failures stay
 * silent so the snackbar never lies about a copy that did not happen. The
 * icon tints to the success color while the copy has resolved — and sits
 * beside the email as a flexShrink:0 cell, never squeezing the address
 * narrower. The users card has NO card-level click handler, so the copy
 * button needs no `stopPropagation` here.
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

import { ContentCopyOutlined as CopyIcon } from "@mui/icons-material";
import { Box, IconButton, Link as MuiLink, Tooltip, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  DirectoryRolePill,
  type DirectoryUserItem,
  useDirectoryCopyEmail,
} from "@/frontend/views/admin/users/directory";
import type { DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface MobileUserNameProps {
  readonly user: DirectoryUserItem;
  readonly labels: Pick<AdminUsersLabels, "quickActions">;
  readonly deleted: boolean;
}

/** The name profile link — the header grid's middle track (see file docblock). */
export function MobileUserName({ user, labels, deleted }: MobileUserNameProps): ReactNode {
  return (
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
        // ≥44px tap target without shifting the layout below: transparent
        // block padding grows the clickable box while the matching negative
        // margins keep the layout height unchanged.
        minHeight: 54,
        paddingBlock: "10.5px",
        marginBlock: "-10.5px",
        ...(deleted && { textDecoration: "line-through" }),
      })}
    >
      {user.fullName}
    </MuiLink>
  );
}

interface MobileUserIdentityProps {
  readonly user: DirectoryUserItem;
  readonly role: DirectoryRole;
  readonly labels: Pick<AdminUsersLabels, "quickActions" | "roleLabels">;
  readonly deleted: boolean;
  /** Invoked after the email copy resolves successfully (drives the snackbar). */
  readonly onCopyEmail?: () => void;
}

/** The full-width email row + role pill below the header grid (see file docblock). */
export function MobileUserIdentity({ user, role, labels, deleted, onCopyEmail }: MobileUserIdentityProps): ReactNode {
  const { emailCopied, handleCopyEmail } = useDirectoryCopyEmail(user.email, onCopyEmail);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          mt: 0.5,
          minWidth: 0,
          // 44px avatar + 8px grid gap — the email starts under the name
          // column; logical property so RTL mirrors the inset. Explicit px
          // STRING — a bare number would go through MUI's spacing transform
          // (×8) and inflate the inset to 416px.
          paddingInlineStart: "52px",
        }}
      >
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
            flex: 1,
            minWidth: 0,
            color: deleted ? theme.palette.text.disabled : theme.palette.text.secondary,
          })}
        >
          {user.email}
        </Typography>
        <Tooltip
          title={emailCopied ? labels.quickActions.emailCopied : labels.quickActions.copyEmail}
          placement="top"
          enterTouchDelay={0}
          leaveTouchDelay={1500}
        >
          <IconButton
            size="small"
            aria-label={`${labels.quickActions.copyEmail}: ${user.email}`}
            onClick={handleCopyEmail}
            sx={theme => ({
              // ≥44px touch target via transparent padding; the icon stays
              // visually 20px. flexShrink: 0 keeps the email at its full
              // available width instead of squeezing under the icon.
              p: 1.5,
              my: -1.5,
              flexShrink: 0,
              color: emailCopied ? theme.palette.success.main : theme.palette.text.secondary,
            })}
          >
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {/* The role pill keeps its identity-area place: under the email row,
          indented at the same 52px inset (logical — flips under RTL). */}
      <Box sx={{ mt: 0.5, paddingInlineStart: "52px" }}>
        <DirectoryRolePill role={role} labels={labels} muted={deleted} />
      </Box>
    </Box>
  );
}
