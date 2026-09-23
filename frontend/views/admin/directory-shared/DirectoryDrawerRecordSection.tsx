"use client";

/**
 * DirectoryDrawerRecordSection — the admin directory detail drawers' record
 * card: the record identifier (wire value, never localized) plus the
 * explicit full-profile link: governance/certification actions live on the
 * admin user-detail page, so the drawer bridges the directory to that
 * surface instead of duplicating them here.
 */

import { OpenInNewOutlined as OpenProfileIcon } from "@mui/icons-material";
import { Button, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { DirectoryDrawerSection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";

interface DirectoryDrawerRecordSectionProps {
  /** The record section's header label. */
  readonly sectionLabel: string;
  /** The identifier row's label. */
  readonly idLabel: string;
  /** The wire record id (rendered verbatim, LTR-pinned). */
  readonly id: number;
  /** The viewProfile quick-action label. */
  readonly viewProfileLabel: string;
}

export function DirectoryDrawerRecordSection({
  sectionLabel,
  idLabel,
  id,
  viewProfileLabel,
}: DirectoryDrawerRecordSectionProps): ReactNode {
  return (
    <DirectoryDrawerSection label={sectionLabel}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography
            variant="body2"
            sx={theme => ({ color: theme.palette.text.secondary, flexBasis: "40%", flexShrink: 0 })}
          >
            {idLabel}
          </Typography>
          <Typography
            variant="body2"
            component="span"
            dir="ltr"
            sx={theme => ({ fontWeight: 500, color: theme.palette.text.primary, unicodeBidi: "isolate" })}
          >
            {id}
          </Typography>
        </Stack>
        <FullProfileLink href={`/admin/users/${id}`} label={viewProfileLabel} />
      </Stack>
    </DirectoryDrawerSection>
  );
}

interface FullProfileLinkProps {
  readonly href: string;
  readonly label: string;
}

/**
 * The "open full profile" action — an outlined navigation button (44px
 * touch floor, same `Button component={Link}` recipe as the empty-state
 * CTA) routed to the admin user-detail page where the governance actions
 * live. Presentational everywhere else: the drawer itself stays read-only.
 */
function FullProfileLink({ href, label }: FullProfileLinkProps): ReactNode {
  return (
    <Button
      component={Link}
      href={href}
      variant="outlined"
      size="small"
      startIcon={<OpenProfileIcon />}
      sx={theme => ({
        minHeight: 44,
        borderRadius: 2,
        textTransform: "none",
        fontWeight: 600,
        alignSelf: "flex-start",
        color: theme.palette.text.primary,
        borderColor: theme.palette.border.light,
      })}
    >
      {label}
    </Button>
  );
}
