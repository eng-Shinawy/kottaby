"use client";

/**
 * CooldownExtensionSection — inline applicant-cooldown extension affordance
 * on the admin user DETAIL page (sits under the read-only applicant
 * snapshot card, mirroring the GovernanceActionsSection pattern: a
 * presentational affordance row + confirm dialog, with all state +
 * mutation orchestration living in `useCooldownExtension`).
 *
 * The action is hidden entirely when no applicant snapshot exists and
 * disabled (with an explanatory note) once the applicant is certified —
 * certification is terminal, so there is no cooldown left to lengthen.
 * The server re-validates every rule (bounds, terminal-on-pass, lengthen-
 * only math); this surface only mirrors the gates so an impossible request
 * never crosses the wire. Success → localized snackbar via the
 * caller-supplied `onToast` callback; the returned profile merges into the
 * Apollo cache (`ApplicantProfile:<id>`, id-first) so the snapshot card
 * re-renders WITHOUT a refetch.
 */

import { EventRepeatOutlined as ExtendIcon, InfoOutlined as InfoIcon } from "@mui/icons-material";
import { Box, Button, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { ApplicantStatus } from "@/frontend/graphql/generated/gql/graphql";
import { CooldownExtensionDialog } from "@/frontend/views/admin/users/detail/CooldownExtensionDialog";
import { useCooldownExtension } from "@/frontend/views/admin/users/hooks/useCooldownExtension";
import { AdminUsers, useAppTranslation } from "@/shared/locale";

const TOUCH = 44;

/** Certification is terminal — a passed applicant has no cooldown left. */
const CERTIFIED_STATUS = ApplicantStatus.Passed;

interface CooldownExtensionSectionProps {
  readonly applicantId: number;
  readonly status: ApplicantStatus;
  readonly onToast: (message: string) => void;
}

export function CooldownExtensionSection({ applicantId, status, onToast }: CooldownExtensionSectionProps): ReactNode {
  const copy = useAppTranslation(AdminUsers).applicantCooldownExtension;
  const api = useCooldownExtension({ applicantId, copy, onToast });
  const certified = status === CERTIFIED_STATUS;

  const button = (
    <Button
      variant="outlined"
      color="warning"
      startIcon={<ExtendIcon />}
      disabled={certified || api.inFlight}
      onClick={api.openDialog}
      aria-label={copy.extendAction}
      sx={{
        ...focusVisibleRingSx,
        minHeight: TOUCH,
        px: 2,
        width: { xs: "100%", sm: "auto" },
        justifyContent: "center",
      }}
    >
      {copy.extendAction}
    </Button>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { sm: "center" }, gap: 1.5 }}>
      {certified ? (
        <Tooltip title={copy.certifiedNote} arrow>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      {certified && (
        <Typography
          variant="caption"
          sx={theme => ({ display: "flex", alignItems: "center", gap: 0.5, color: theme.palette.text.disabled })}
        >
          <InfoIcon sx={{ fontSize: 16 }} />
          {copy.certifiedNote}
        </Typography>
      )}
      <CooldownExtensionDialog copy={copy} api={api} />
    </Box>
  );
}
