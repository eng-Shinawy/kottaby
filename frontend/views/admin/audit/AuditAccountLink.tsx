"use client";

/**
 * AuditAccountLink — the audit trail's account-navigation link: the one
 * hover/underline/focus treatment shared by BOTH account affordances of
 * the trail (so the two can never drift):
 *
 *  - the ACTOR cell's display-name link — the acting account's
 *    `/admin/users/{id}` detail page;
 *  - the `user`-entity row's entity-id link — the affected account's
 *    detail page, rendered in the fixed-pitch LTR-pinned id treatment.
 *
 * The deep link is honest by construction: the ids ride the wire on the
 * entry (`actorId` / `entityId`), and the target route renders a
 * localized not-found section for a deleted account instead of erroring.
 * The accessible name composes the localized action label with the
 * link's own visible context (the name, or the `#id`), mirroring the
 * directory name-link recipe. RTL-safe: no physical direction properties —
 * the mono variant pins `dir="ltr"` via the HTML attribute (the cssjanus
 * flip cannot touch an attribute) plus `unicode-bidi: isolate`, so Latin
 * ids never mirror inside the RTL layout.
 */

import { Link as MuiLink } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { AUDIT_MONO_FONT_FAMILY } from "@/frontend/views/admin/audit/audit-trail-skin";

interface AuditAccountLinkProps {
  /** The detail route (`/admin/users/{id}`). */
  readonly href: string;
  /** The composed accessible name (localized label + visible context). */
  readonly ariaLabel: string;
  /** `true` renders the fixed-pitch, LTR-pinned id-atom treatment. */
  readonly mono?: boolean;
  readonly children: ReactNode;
}

export function AuditAccountLink({
  href,
  ariaLabel,
  mono = false,
  children,
}: Readonly<AuditAccountLinkProps>): ReactNode {
  return (
    <MuiLink
      component={Link}
      href={href}
      aria-label={ariaLabel}
      underline="none"
      dir={mono ? "ltr" : undefined}
      sx={theme => ({
        color: theme.palette.text.primary,
        fontWeight: 600,
        fontSize: 14,
        lineHeight: 1.45,
        borderRadius: "6px",
        ...(mono ? { fontFamily: AUDIT_MONO_FONT_FAMILY, unicodeBidi: "isolate" } : {}),
        ...focusVisibleRingSx,
        "&:hover": { color: theme.palette.primary.main, textDecoration: "underline" },
      })}
    >
      {children}
    </MuiLink>
  );
}
