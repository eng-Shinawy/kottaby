"use client";

/**
 * One trail row of the raw-MUI `Table`: locale-aware `createdAt` stamp,
 * actor, the shared tone-mapped `action*` chip, entity columns and the
 * per-row expandable `details` block — rendered VERBATIM inside a
 * `dir="auto"` pre-formatted element (mixed-direction JSON blobs), with the
 * namespace em-dash placeholders for the null `details`/`entityId` cells.
 *
 * The When cell reads on two lines: a RELATIVE caption for recent entries
 * (the shared `formatRelativeAuditStamp` — null beyond its bounded window)
 * as the scanning line and the deterministic ABSOLUTE stamp beneath it as
 * the precision line; out-of-window entries render the absolute stamp alone.
 * The entity-id cell is a fixed-pitch, LTR-pinned atom (`dir` attribute +
 * `unicode-bidi: isolate` — the cssjanus flip cannot touch either) so Latin
 * ids never mirror inside the RTL layout.
 *
 * Account navigation: the ACTOR name links to the acting account's admin
 * detail page, and a `user`-entity row's entity id links to that account's
 * detail page (the shared `AuditAccountLink` treatment — one hover/focus
 * recipe for both affordances). Rows alternate through the zebra lane of
 * the shared `trailRowSx` so the wide fixed-layout table keeps scannable.
 */

import { Box, TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminAuditLogsQuery_adminAuditLogs_items,
  AuditActionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { formatRelativeAuditStamp } from "@/frontend/lib/i18n/relative-time";
import { AuditAccountLink } from "@/frontend/views/admin/audit/AuditAccountLink";
import { AuditCopyEntityRefButton } from "@/frontend/views/admin/audit/AuditCopyEntityRefButton";
import { AuditDetailsDisclosure } from "@/frontend/views/admin/audit/AuditDetailsDisclosure";
import { AuditEntityTypeChip } from "@/frontend/views/admin/audit/AuditEntityTypeChip";
import { auditEntityIdContentOf } from "@/frontend/views/admin/audit/audit-trail-filters";
import {
  AUDIT_MONO_FONT_FAMILY,
  actionChipSx,
  bodyCellSx,
  trailRowSx,
} from "@/frontend/views/admin/audit/audit-trail-skin";
import { DirectoryHeaderCell } from "@/frontend/views/admin/directory-shared/DirectoryHeaderCell";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface AuditTrailHeaderCellProps {
  readonly children: ReactNode;
  readonly width: string;
}

/**
 * Header cell — the shared uppercase directory header cell
 * (`DirectoryHeaderCell`), aliased under the audit-trail name for the
 * trail's header row in `AuditTrailResults`.
 */
export function AuditTrailHeaderCell(props: Readonly<AuditTrailHeaderCellProps>): ReactNode {
  return <DirectoryHeaderCell {...props} />;
}

/**
 * When-cell content: the relative caption (recent entries) riding above the
 * absolute precision stamp, or the absolute stamp alone once the entry is
 * older than the relative window.
 */
function WhenCellContent({ iso, locale }: Readonly<{ iso: string; locale: string }>): ReactNode {
  const relative = formatRelativeAuditStamp(iso, locale);
  if (relative === null) {
    return (
      <Typography variant="body2" component="p">
        {formatApplicantDate(iso, locale)}
      </Typography>
    );
  }
  return (
    <>
      <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
        {relative}
      </Typography>
      <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {formatApplicantDate(iso, locale)}
      </Typography>
    </>
  );
}

interface AuditTrailRowProps {
  readonly entry: AdminAuditLogsQuery_adminAuditLogs_items;
  readonly tableLabels: AdminUsersLabels["auditTrail"]["table"];
  /** The auditTrail label block — the entity-type chips' localized vocabulary. */
  readonly entityLabels: AdminUsersLabels["auditTrail"];
  readonly locale: string;
  readonly actionLabels: Record<AuditActionType, string>;
  readonly isExpanded: boolean;
  /** Zero-based position of the row in the current page (the zebra lane). */
  readonly rowIndex: number;
  readonly onToggleDetails: (entryId: string) => void;
}

export function AuditTrailRow({
  entry,
  tableLabels,
  entityLabels,
  locale,
  actionLabels,
  isExpanded,
  rowIndex,
  onToggleDetails,
}: Readonly<AuditTrailRowProps>): ReactNode {
  // The entity-id cell's content, resolved BEFORE the row renders (the
  // shared discriminator — statement form, no nested conditionals): the
  // em-dash placeholder, the user account deep link, or the plain id atom.
  const entityIdContent = auditEntityIdContentOf(entry);
  let entityIdCell: ReactNode;
  if (entityIdContent.kind === "null") {
    entityIdCell = (
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {tableLabels.noEntityIdValue}
      </Typography>
    );
  } else if (entityIdContent.kind === "accountLink") {
    entityIdCell = (
      <AuditAccountLink
        mono
        href={`/admin/users/${entityIdContent.userId}`}
        ariaLabel={`${tableLabels.userEntityLinkLabel} #${entityIdContent.userId}`}
      >
        {entityIdContent.userId}
      </AuditAccountLink>
    );
  } else {
    entityIdCell = (
      <Typography
        variant="body2"
        component="p"
        dir="ltr"
        sx={{ fontFamily: AUDIT_MONO_FONT_FAMILY, unicodeBidi: "isolate" }}
      >
        {entityIdContent.entityId}
      </Typography>
    );
  }

  return (
    <TableRow sx={theme => trailRowSx(theme, rowIndex % 2 === 1)}>
      <TableCell sx={bodyCellSx}>
        <WhenCellContent iso={entry.createdAt} locale={locale} />
      </TableCell>
      <TableCell sx={bodyCellSx}>
        <AuditAccountLink
          href={`/admin/users/${entry.actorId}`}
          ariaLabel={`${tableLabels.actorLinkLabel}: ${entry.actorName}`}
        >
          {entry.actorName}
        </AuditAccountLink>
      </TableCell>
      <TableCell sx={bodyCellSx}>
        <Box component="span" sx={theme => actionChipSx(theme, entry.actionType)}>
          {actionLabels[entry.actionType]}
        </Box>
      </TableCell>
      <TableCell sx={bodyCellSx}>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, maxWidth: "100%" }}>
          <AuditEntityTypeChip entityType={entry.entityType} labels={entityLabels} />
          {entry.entityId !== null ? (
            <AuditCopyEntityRefButton
              entityType={entry.entityType}
              entityId={String(entry.entityId)}
              copyLabel={tableLabels.entityRefCopy}
              copiedLabel={tableLabels.entityRefCopied}
            />
          ) : null}
        </Box>
      </TableCell>
      <TableCell sx={bodyCellSx}>{entityIdCell}</TableCell>
      <TableCell sx={bodyCellSx}>
        {entry.details !== null ? (
          <AuditDetailsDisclosure
            entryId={entry.id}
            details={entry.details}
            isExpanded={isExpanded}
            onToggleDetails={onToggleDetails}
            hideLabel={tableLabels.detailsHideLabel}
            showLabel={tableLabels.detailsShowLabel}
          />
        ) : (
          <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {tableLabels.noDetailsValue}
          </Typography>
        )}
      </TableCell>
    </TableRow>
  );
}
