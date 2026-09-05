"use client";

/**
 * GovernanceCard — the governance summary card of the admin user DETAIL
 * page (prototype's "Governance" card).
 *
 * A 2-column grid of eyebrow-labeled values replaces the legacy sparse
 * label/value list (which left the card ~65% empty):
 *  - STATUS renders the `DirectoryGovernanceLabel` dot-text variant (the
 *    dot + tinted label — the governance state appears textually here and
 *    as a pill only in the hero; no 3× chip duplication).
 *  - SUSPENDED / BLOCKED / DELETED render Yes/No via the localized
 *    `booleanValues`.
 *  - `suspendedAt` / `blockedAt` / `deletedAt` rows are appended ONLY when
 *    the corresponding timestamp is set.
 *  - Every grid row except the last carries a subtle `divider` hairline
 *    (computed from the cell count so the optional timestamp rows never
 *    leave a dangling rule at the bottom).
 *
 * Footer: tinted strip with the localized governance note, pinned to the
 * bottom of the card (spacer + flex-column card) so the narrow column can
 * stretch to the wide column's height.
 */

import { GavelOutlined as GavelIcon } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUserDetailQuery_adminUserDetail } from "@/frontend/graphql/generated/gql/graphql";
import { DetailCard, DetailCardTitle, DetailEyebrow, DetailInfoStrip } from "@/frontend/views/admin/users/detail";
import { DirectoryGovernanceLabel } from "@/frontend/views/admin/users/directory";
import type { DirectoryGovernance } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DetailUser = AdminUserDetailQuery_adminUserDetail;

interface GovernanceCardProps {
  readonly user: DetailUser;
  readonly governance: DirectoryGovernance;
  readonly labels: Pick<AdminUsersLabels, "headers" | "statusBadges" | "detail">;
  /** Locale-bound date-time formatter (suspension/block timestamps). */
  readonly formatTimestamp: (raw: string | null | undefined) => string;
}

/** Localized Yes/No from the `booleanValues` block. */
function booleanLabel(flag: boolean | null, values: AdminUsersLabels["detail"]["booleanValues"]): string {
  return flag ? values.yes : values.no;
}

interface GovernanceCellProps {
  readonly eyebrow: string;
  /** Non-last-row cells carry a subtle hairline + breathing room under the value. */
  readonly divider?: boolean;
  readonly children: ReactNode;
}

function GovernanceCell({ eyebrow, divider = false, children }: GovernanceCellProps): ReactNode {
  return (
    <Box
      sx={theme => ({
        minWidth: 0,
        // The hairlines run edge-to-edge across BOTH columns (the odd cell's
        // inline-end padding only insets its content, not the border), so a
        // grid row reads as one continuous divider.
        pb: divider ? 1.5 : 0,
        mb: divider ? 2.5 : 0,
        borderBottom: divider ? `1px solid ${theme.palette.divider}` : 0,
        "&:nth-of-type(odd)": { paddingInlineEnd: 16 },
      })}
    >
      <DetailEyebrow>{eyebrow}</DetailEyebrow>
      <Box sx={{ mt: 0.75 }}>{children}</Box>
    </Box>
  );
}

/** Plain 500-weight text value for the boolean/date cells. */
function GovernanceValue({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <Typography variant="body2" sx={theme => ({ fontWeight: 500, color: theme.palette.text.primary })}>
      {children}
    </Typography>
  );
}

interface GovernanceCellDef {
  readonly key: string;
  readonly eyebrow: string;
  readonly value: ReactNode;
}

export function GovernanceCard({ user, governance, labels, formatTimestamp }: GovernanceCardProps): ReactNode {
  // Cell definitions first, so the number of cells in the LAST grid row is
  // known before render — non-last-row cells carry the hairline divider.
  const cellDefs: GovernanceCellDef[] = [
    {
      key: "status",
      eyebrow: labels.headers.status,
      value: <DirectoryGovernanceLabel governance={governance} labels={labels} variant="dot-text" />,
    },
    {
      key: "suspended",
      eyebrow: labels.statusBadges.suspended,
      value: <GovernanceValue>{booleanLabel(user.suspended, labels.detail.booleanValues)}</GovernanceValue>,
    },
    {
      key: "blocked",
      eyebrow: labels.statusBadges.blocked,
      value: <GovernanceValue>{booleanLabel(user.isBlocked, labels.detail.booleanValues)}</GovernanceValue>,
    },
    {
      key: "deleted",
      eyebrow: labels.statusBadges.deleted,
      value: <GovernanceValue>{booleanLabel(user.isDeleted, labels.detail.booleanValues)}</GovernanceValue>,
    },
  ];
  if (user.suspendedAt) {
    cellDefs.push({
      key: "suspendedAt",
      eyebrow: labels.detail.suspendedAt,
      value: <GovernanceValue>{formatTimestamp(user.suspendedAt)}</GovernanceValue>,
    });
  }
  if (user.blockedAt) {
    cellDefs.push({
      key: "blockedAt",
      eyebrow: labels.detail.blockedAt,
      value: <GovernanceValue>{formatTimestamp(user.blockedAt)}</GovernanceValue>,
    });
  }
  if (user.deletedAt) {
    cellDefs.push({
      key: "deletedAt",
      eyebrow: labels.detail.deletedAt,
      value: <GovernanceValue>{formatTimestamp(user.deletedAt)}</GovernanceValue>,
    });
  }
  const lastRowCellCount = cellDefs.length % 2 === 0 ? 2 : 1;
  return (
    // flexGrow wrapper: the narrow grid column stretches to the wide column's
    // height; the card becomes a flex column and the spacer above the info
    // strip pins the strip to the card bottom.
    <Box
      sx={{
        flexGrow: 1,
        minWidth: 0,
        display: "flex",
        "& > *": { flexGrow: 1, display: "flex", flexDirection: "column" },
      }}
    >
      <DetailCard>
        <DetailCardTitle icon={<GavelIcon />} title={labels.detail.governance} />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          {cellDefs.map((cell, index) => (
            <GovernanceCell key={cell.key} eyebrow={cell.eyebrow} divider={index < cellDefs.length - lastRowCellCount}>
              {cell.value}
            </GovernanceCell>
          ))}
        </Box>
        {/* Spacer absorbs the stretch so the info strip stays at the bottom. */}
        <Box aria-hidden sx={{ flexGrow: 1 }} />
        <DetailInfoStrip note={labels.detail.governanceNote} />
      </DetailCard>
    </Box>
  );
}
