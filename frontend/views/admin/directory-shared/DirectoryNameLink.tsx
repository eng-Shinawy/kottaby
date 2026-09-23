"use client";

/**
 * DirectoryNameLink — the name PROFILE LINK of the admin directory identity
 * surfaces (the desktop user/applicant identity cells and the applicant
 * mobile card): every applicant IS a user, so `/admin/users/{id}` is the
 * governance surface where certification actions live. The link keeps the
 * shared single-line ellipsis recipe and the ≥44px tap-target padding
 * (transparent block padding + matching negative margins, so the clickable
 * box grows without shifting the layout).
 *
 * Bidi note (Latin names inside an RTL page): the HTML `dir="ltr"`
 * ATTRIBUTE isolates glyph direction — a CSS `direction` rule MUST NOT be
 * added (stylis-plugin-rtl would flip it and clip the string's head).
 */

import { Link as MuiLink } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";

interface DirectoryNameLinkProps {
  /** The profile route (`/admin/users/{id}`). */
  readonly href: string;
  readonly name: string;
  /** The viewProfile quick-action label — composed into the aria-label. */
  readonly viewProfileLabel: string;
  /** Soft-deleted items render dimmed + struck through. */
  readonly deleted?: boolean;
}

export function DirectoryNameLink({
  href,
  name,
  viewProfileLabel,
  deleted = false,
}: DirectoryNameLinkProps): ReactNode {
  return (
    <MuiLink
      component={Link}
      href={href}
      underline="hover"
      aria-label={`${viewProfileLabel}: ${name}`}
      title={name}
      dir="ltr"
      sx={theme => ({
        // Single-line ellipsis recipe + the 44px tap-target trick, in one
        // composed rule (property order is irrelevant — no key conflicts).
        display: "block",
        overflow: "hidden",
        fontSize: 15,
        fontWeight: 600,
        textAlign: "start",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        unicodeBidi: "isolate",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: 44,
        paddingBlock: "10.5px",
        marginBlock: "-10.5px",
        color: deleted ? theme.palette.text.disabled : theme.palette.text.primary,
        ...(deleted && { textDecoration: "line-through" }),
      })}
    >
      {name}
    </MuiLink>
  );
}
