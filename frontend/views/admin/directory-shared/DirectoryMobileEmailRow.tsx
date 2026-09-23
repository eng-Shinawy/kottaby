"use client";

/**
 * DirectoryMobileEmailRow — the full-card-width email row rendered between
 * the header grid and the divider of the mobile directory cards (students /
 * teachers / applicants). Layout rationale (QA fix): the old placement
 * inside the header grid's middle track squeezed addresses into ~180px and
 * wrapped them mid-word — the row now spans the whole card and is inset
 * with the LOGICAL `paddingInlineStart: "52px"` (44px avatar + 8px grid
 * gap) so the email aligns under the name column; the inset flips correctly
 * under RTL. The email WRAPS (no ellipsis) so the full address stays
 * visible, with `overflowWrap: "anywhere"` as the pathological-address
 * fallback. The copy affordance (clipboard + success tint +
 * `stopPropagation`, ≥44px touch target via transparent padding,
 * `flexShrink: 0`) is shared with the drawer/desktop identity surfaces.
 *
 * Bidi note (Latin emails inside an RTL page): the HTML `dir="ltr"`
 * ATTRIBUTE isolates glyph direction — a CSS `direction` rule MUST NOT be
 * added (stylis-plugin-rtl would flip it and clip the string's head). With
 * the attribute alone plus `unicodeBidi: "isolate"`, `text-align: start`
 * reads correctly in both directions.
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryCopyEmailButton } from "@/frontend/views/admin/directory-shared/DirectoryCopyEmailButton";
import { useDirectoryCopyEmail } from "@/frontend/views/admin/users/directory/useDirectoryCopyEmail";

interface DirectoryMobileEmailRowProps {
  readonly email: string;
  /** Soft-deleted items drop the address to the disabled ink. */
  readonly deleted?: boolean;
  /** The copy quick-action label. */
  readonly copyEmailLabel: string;
  /** The post-copy quick-action label. */
  readonly emailCopiedLabel: string;
  /** Invoked after the email copy resolves successfully (drives the snackbar). */
  readonly onCopyEmail?: () => void;
}

export function DirectoryMobileEmailRow({
  email,
  deleted = false,
  copyEmailLabel,
  emailCopiedLabel,
  onCopyEmail,
}: DirectoryMobileEmailRowProps): ReactNode {
  const { emailCopied, handleCopyEmail } = useDirectoryCopyEmail(email, onCopyEmail);
  return (
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
        component="div"
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
        {email}
      </Typography>
      <DirectoryCopyEmailButton
        email={email}
        copied={emailCopied}
        copyLabel={copyEmailLabel}
        copiedLabel={emailCopiedLabel}
        onCopy={handleCopyEmail}
        noShrink
      />
    </Box>
  );
}
