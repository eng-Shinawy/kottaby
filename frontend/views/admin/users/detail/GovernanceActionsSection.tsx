"use client";

/**
 * GovernanceActionsSection — inline suspend / unsuspend / block / unblock
 * affordance card on the admin user DETAIL page (sits under the read-only
 * GovernanceCard). The actions live in their own `DetailCard` (titled via
 * `governanceActions.title`) so the narrow detail column reads as one
 * uniform stack of cards instead of a bare button row floating between
 * cards. The component is presentational ONLY; all state + mutation
 * orchestration + conflict-code routing lives in `useGovernanceActions`
 * (`frontend/views/admin/users/hooks`).
 *
 * Behavior: each action opens a confirm dialog; the Suspend dialog
 * additionally captures a REQUIRED integer `periodDays` (1..3650) — the
 * client mirrors the server-side VALIDATION gate so an invalid value never
 * crosses the wire. Apollo merges the post-write detail fragment into the
 * SAME `AdminUserDetail:<id>` normalized entity (id-first) so the detail
 * query re-renders WITHOUT a refetch. Success → localized snackbar via the
 * caller-supplied `onToast` callback. Conflict routing (FORBIDDEN → toast
 * path; VALIDATION → field helperText; others → in-dialog Alert) lives in
 * the hook. i18n: `useAppTranslation(AdminUsers)` + property access
 * (t.governanceActions.*) ONLY.
 */

import {
  BlockOutlined as BlockIcon,
  GavelOutlined as GavelIcon,
  ShieldOutlined as SuspendIcon,
  LockOpenOutlined as UnblockIcon,
  CheckCircleOutlined as UnsuspendIcon,
} from "@mui/icons-material";
import { Box, Button } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { AdminUserDetailQuery_adminUserDetail } from "@/frontend/graphql/generated/gql/graphql";
import { GovernanceConfirmDialog } from "@/frontend/views/admin/users/detail/GovernanceConfirmDialog";
import { DetailCard, DetailCardTitle } from "@/frontend/views/admin/users/detail/UserDetailPrimitives";
import { useGovernanceActions } from "@/frontend/views/admin/users/hooks/useGovernanceActions";
import { AdminUsers, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type ActionKind = "suspend" | "unsuspend" | "block" | "unblock";
type Copy = AdminUsersLabels["governanceActions"];

interface GovernanceActionsSectionProps {
  readonly user: AdminUserDetailQuery_adminUserDetail;
  readonly onToast: (message: string) => void;
}

interface ActionButton {
  readonly kind: ActionKind;
  readonly label: string;
  readonly color: "warning" | "success" | "error" | "primary";
  readonly icon: ReactNode;
  readonly disabled: boolean;
}

const TOUCH = 44;

interface GovernanceState {
  readonly deleted: boolean;
  readonly suspended: boolean;
  readonly blocked: boolean;
  readonly inFlight: boolean;
}

/** Builds the 4 state-gated affordance buttons (each enabled only in the state it can act on). */
function buildButtons(copy: Copy, state: GovernanceState): ReadonlyArray<ActionButton> {
  const { deleted, suspended, blocked, inFlight } = state;
  return [
    {
      kind: "suspend",
      label: copy.suspendAction,
      color: "warning",
      icon: <SuspendIcon />,
      disabled: deleted || suspended || inFlight,
    },
    {
      kind: "unsuspend",
      label: copy.unsuspendAction,
      color: "success",
      icon: <UnsuspendIcon />,
      disabled: deleted || !suspended || inFlight,
    },
    {
      kind: "block",
      label: copy.blockAction,
      color: "error",
      icon: <BlockIcon />,
      disabled: deleted || blocked || inFlight,
    },
    {
      kind: "unblock",
      label: copy.unblockAction,
      color: "primary",
      icon: <UnblockIcon />,
      disabled: deleted || !blocked || inFlight,
    },
  ];
}

export function GovernanceActionsSection({ user, onToast }: GovernanceActionsSectionProps): ReactNode {
  const copy = useAppTranslation(AdminUsers).governanceActions;
  const api = useGovernanceActions({ user, copy, onToast });
  const buttons = buildButtons(copy, {
    deleted: user.isDeleted ?? false,
    suspended: user.suspended ?? false,
    blocked: user.isBlocked ?? false,
    inFlight: api.inFlight,
  });

  return (
    <DetailCard>
      <DetailCardTitle icon={<GavelIcon />} title={copy.title} />
      <Box
        sx={{
          display: "grid",
          // 2×2 equal-width cells at EVERY breakpoint: the detail column is
          // the narrow 5/12 grid half, so a 4-across row squeezes the icon +
          // label pairs into clipped text — the square grid keeps every
          // button the same width with room for the longest label (and the
          // 44px touch minimum) at any viewport.
          gridTemplateColumns: "1fr 1fr",
          gap: 1.5,
        }}
      >
        {buttons.map(btn => (
          <Button
            key={btn.kind}
            variant="outlined"
            color={btn.color}
            startIcon={btn.icon}
            disabled={btn.disabled}
            onClick={() => api.openDialog(btn.kind)}
            aria-label={btn.label}
            sx={theme => ({
              ...focusVisibleRingSx,
              minHeight: TOUCH,
              minWidth: TOUCH,
              px: 1.5,
              py: 1.25,
              width: "100%",
              justifyContent: "center",
              // Destructive lane: a faint error wash behind the outlined
              // control makes its severity legible before the label is read
              // (skipped while disabled so the muted state stays inert).
              ...(btn.color === "error" && {
                "&:not(:disabled)": { bgcolor: alpha(theme.palette.error.main, 0.08) },
                "&:not(:disabled):hover": { bgcolor: alpha(theme.palette.error.main, 0.12) },
              }),
            })}
          >
            {btn.label}
          </Button>
        ))}
      </Box>
      <GovernanceConfirmDialog copy={copy} api={api} />
    </DetailCard>
  );
}
