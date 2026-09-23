"use client";

/**
 * DirectoryDrawerIdentitySection — the admin directory detail drawers'
 * identity hero card: role-tinted avatar, name, copy-email affordance, and
 * the contact rows (phone / country / joined). The students' and teachers'
 * drawers render the same card from their own label namespaces — every
 * caption arrives as a prop (no hardcoded strings); data values render
 * verbatim.
 *
 * RTL/bidi: Latin names/emails/phones are pinned with the HTML `dir="ltr"`
 * ATTRIBUTE + `unicodeBidi: isolate` — a CSS `direction` rule MUST NOT be
 * added (stylis-plugin-rtl flips it and clips the string's head).
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { DirectoryCopyEmailButton } from "@/frontend/views/admin/directory-shared/DirectoryCopyEmailButton";
import {
  DirectoryDrawerSection,
  DirectoryEmptyValue,
  DirectoryLabelValueRow,
} from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import { useDirectoryCopyEmail } from "@/frontend/views/admin/users/directory/useDirectoryCopyEmail";
import { UserAvatar } from "@/frontend/views/admin/users/ui";
import type { AdminSurfaceRole } from "@/frontend/views/admin/users/ui/AdminUserAvatar";
import type { AppLocale } from "@/shared/locale";

interface DirectoryDrawerIdentitySectionProps {
  /** The identity section's header label. */
  readonly sectionLabel: string;
  readonly name: string;
  readonly email: string;
  /** Avatar role lane (expression-passed — matches the rows). */
  readonly avatarRole: AdminSurfaceRole;
  readonly copyEmailLabel: string;
  readonly emailCopiedLabel: string;
  readonly phoneLabel: string;
  readonly phone: string | null;
  readonly countryLabel: string;
  readonly country: string | null;
  readonly joinedLabel: string;
  /** The item's wire `createdAt` (rendered through the shared date util). */
  readonly createdAt: string;
  readonly locale: AppLocale;
  /** Invoked after the drawer's copy-email action resolves (drives the shared snackbar). */
  readonly onCopyEmail?: () => void;
}

/** Identity hero — role-tinted avatar, name, copy-email affordance, contact rows. */
export function DirectoryDrawerIdentitySection({
  sectionLabel,
  name,
  email,
  avatarRole,
  copyEmailLabel,
  emailCopiedLabel,
  phoneLabel,
  phone,
  countryLabel,
  country,
  joinedLabel,
  createdAt,
  locale,
  onCopyEmail,
}: DirectoryDrawerIdentitySectionProps): ReactNode {
  const { emailCopied, handleCopyEmail } = useDirectoryCopyEmail(email, onCopyEmail);
  return (
    <DirectoryDrawerSection label={sectionLabel}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 1.5 }}>
        <UserAvatar fullName={name} role={avatarRole} size={64} />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="div"
            title={name}
            dir="ltr"
            sx={{
              fontSize: 17,
              fontWeight: 600,
              unicodeBidi: "isolate",
              textAlign: "start",
              overflowWrap: "anywhere",
            }}
          >
            {name}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography
              variant="body2"
              component="div"
              title={email}
              dir="ltr"
              sx={theme => ({
                color: theme.palette.text.secondary,
                unicodeBidi: "isolate",
                textAlign: "start",
                overflowWrap: "anywhere",
                minWidth: 0,
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
          </Stack>
        </Box>
      </Stack>
      <DirectoryLabelValueRow label={phoneLabel} ltr>
        {phone ?? <DirectoryEmptyValue />}
      </DirectoryLabelValueRow>
      <DirectoryLabelValueRow label={countryLabel}>{country ?? <DirectoryEmptyValue />}</DirectoryLabelValueRow>
      <DirectoryLabelValueRow label={joinedLabel}>{formatApplicantDate(createdAt, locale)}</DirectoryLabelValueRow>
    </DirectoryDrawerSection>
  );
}
