"use client";

/**
 * ApplicantOverrideSection — the admin applicant-evaluation override
 * affordance on the user DETAIL page (sits under the cooldown-extension
 * row, mirroring the GovernanceActionsSection button-grid pattern inside
 * the page's `DetailCard` recipe). Presentational ONLY — all state +
 * mutation orchestration + conflict-code routing lives in
 * `useApplicantOverride`.
 *
 * Three directions over one wire enum (certify / grant re-evaluation /
 * reject), each eligibility-gated client-side so an impossible request
 * never crosses the wire — the server re-validates every rule (terminal
 * certification, active cooldown presence, passed-only rejection):
 *  - Certify            → disabled once `status === passed` (terminal);
 *  - Grant re-evaluation→ disabled unless the cooldown is Active/Expired;
 *  - Reject             → disabled unless `status === passed`.
 * Disabled affordances carry an explanatory Tooltip. Success → localized
 * snackbar via the caller-supplied `onToast` callback; the returned profile
 * merges into the Apollo cache (`ApplicantProfile:<id>`, id-first) so the
 * snapshot card re-renders WITHOUT a refetch.
 */

import {
  GppGoodOutlined as CertifyIcon,
  AutorenewOutlined as GrantIcon,
  FactCheckOutlined as OverrideIcon,
  GppBadOutlined as RejectIcon,
} from "@mui/icons-material";
import { Box, Button, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import {
  AdminApplicantOverrideAction,
  type ApplicantCooldownState,
  type ApplicantStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { ApplicantOverrideDialog } from "@/frontend/views/admin/users/detail/ApplicantOverrideDialog";
import { DetailCard, DetailCardTitle } from "@/frontend/views/admin/users/detail/UserDetailPrimitives";
import {
  isCertifyEligible,
  isGrantEligible,
  isRejectEligible,
  type OverrideAction,
} from "@/frontend/views/admin/users/hooks/applicant-override-helpers";
import { useApplicantOverride } from "@/frontend/views/admin/users/hooks/useApplicantOverride";
import { AdminUsers, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const TOUCH = 44;

interface ApplicantOverrideSectionProps {
  readonly applicantId: number;
  readonly status: ApplicantStatus;
  readonly cooldownState: ApplicantCooldownState;
  readonly onToast: (message: string) => void;
}

interface OverrideButtonSpec {
  readonly action: OverrideAction;
  readonly label: string;
  readonly color: "success" | "secondary" | "error";
  readonly icon: ReactNode;
  readonly enabled: boolean;
  readonly note: string;
}

function buttonSpecs(
  copy: AdminUsersLabels["applicantOverride"],
  status: ApplicantStatus,
  cooldownState: ApplicantCooldownState
): OverrideButtonSpec[] {
  return [
    {
      action: AdminApplicantOverrideAction.Certify,
      label: copy.certifyTitle,
      color: "success",
      icon: <CertifyIcon />,
      enabled: isCertifyEligible(status),
      note: copy.certifyDisabledNote,
    },
    {
      action: AdminApplicantOverrideAction.GrantReEvaluation,
      label: copy.grantTitle,
      color: "secondary",
      icon: <GrantIcon />,
      enabled: isGrantEligible(cooldownState),
      note: copy.grantDisabledNote,
    },
    {
      action: AdminApplicantOverrideAction.Reject,
      label: copy.rejectTitle,
      color: "error",
      icon: <RejectIcon />,
      enabled: isRejectEligible(status),
      note: copy.rejectDisabledNote,
    },
  ];
}

export function ApplicantOverrideSection({
  applicantId,
  status,
  cooldownState,
  onToast,
}: ApplicantOverrideSectionProps): ReactNode {
  const copy = useAppTranslation(AdminUsers).applicantOverride;
  const api = useApplicantOverride({ applicantId, copy, onToast });
  const buttons = buttonSpecs(copy, status, cooldownState);

  return (
    <DetailCard>
      <DetailCardTitle icon={<OverrideIcon />} title={copy.label} />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, mb: 2 })}>
        {copy.caption}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
        {buttons.map(btn => {
          const button = (
            <Button
              key={btn.action}
              variant="outlined"
              color={btn.color}
              startIcon={btn.icon}
              disabled={!btn.enabled || api.inFlight}
              onClick={() => api.startAction(btn.action)}
              aria-label={btn.label}
              sx={{ ...focusVisibleRingSx, minHeight: TOUCH, width: "100%", justifyContent: "center" }}
            >
              {btn.label}
            </Button>
          );
          // Disabled buttons swallow pointer events — the span bridge keeps
          // the explanatory Tooltip reachable while the action is gated off.
          if (btn.enabled) return button;
          return (
            <Tooltip key={btn.action} title={btn.note} arrow>
              <span>{button}</span>
            </Tooltip>
          );
        })}
      </Box>
      <ApplicantOverrideDialog copy={copy} api={api} />
    </DetailCard>
  );
}
