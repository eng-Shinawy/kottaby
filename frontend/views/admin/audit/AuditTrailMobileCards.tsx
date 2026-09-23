"use client";

/**
 * AuditTrailMobileCards — the mobile (< md) rendering of the audit trail:
 * a vertical stack of per-entry cards replacing the desktop table's
 * horizontal-scroll track (an 860px min-width table inside a 390px
 * viewport shears mid-column with no visible affordance).
 *
 * Each card mirrors the desktop row's semantics one-to-one — `createdAt`
 * stamp (the same two-line relative + absolute treatment as the table's
 * When cell), actor, the same tone-mapped action chip, entity type/id, and
 * the per-entry expandable verbatim `details` block in a `dir="auto"` pre —
 * reusing the shared `tableLabels` vocabulary so no new copy is introduced.
 * The account-navigation affordances mirror the row as well: the actor
 * name and a `user`-entity row's entity id render as the shared
 * `AuditAccountLink` (one treatment across both renderers). Visible only
 * below the `md` breakpoint; the table owns `md` and up.
 */

import { Box, Card, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminAuditLogsQuery_adminAuditLogs_items,
  AuditActionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { AuditAccountLink } from "@/frontend/views/admin/audit/AuditAccountLink";
import { AuditCopyEntityRefButton } from "@/frontend/views/admin/audit/AuditCopyEntityRefButton";
import { AuditDetailsDisclosure } from "@/frontend/views/admin/audit/AuditDetailsDisclosure";
import { AuditEntityTypeChip } from "@/frontend/views/admin/audit/AuditEntityTypeChip";
import { CardFact, WhenFact } from "@/frontend/views/admin/audit/AuditTrailMobileFacts";
import { auditEntityIdContentOf } from "@/frontend/views/admin/audit/audit-trail-filters";
import { actionChipSx } from "@/frontend/views/admin/audit/audit-trail-skin";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type AuditTableLabels = AdminUsersLabels["auditTrail"]["table"];

interface AuditTrailMobileCardsProps {
  readonly entries: readonly AdminAuditLogsQuery_adminAuditLogs_items[];
  readonly tableLabels: AuditTableLabels;
  /** The auditTrail label block — the entity-type chips' localized vocabulary. */
  readonly entityLabels: AdminUsersLabels["auditTrail"];
  readonly locale: string;
  readonly actionLabels: Record<AuditActionType, string>;
  readonly expandedDetailsId: string | null;
  readonly onToggleDetails: (entryId: string) => void;
}

/** One audit entry card — mirrors the desktop row's cell semantics. */
function AuditTrailCard({
  entry,
  tableLabels,
  entityLabels,
  locale,
  actionLabels,
  isExpanded,
  onToggleDetails,
}: Readonly<{
  entry: AdminAuditLogsQuery_adminAuditLogs_items;
  tableLabels: AuditTableLabels;
  entityLabels: AdminUsersLabels["auditTrail"];
  actionLabels: Record<AuditActionType, string>;
  locale: string;
  isExpanded: boolean;
  onToggleDetails: (entryId: string) => void;
}>): ReactNode {
  // The entity-id fact's value, resolved BEFORE the card renders (the
  // shared discriminator — statement form, no nested conditionals): the
  // em-dash placeholder, the user account deep link, or the bare id. Kept
  // inline-safe (string or inline element) so CardFact never nests block
  // elements inside its own `<p>`.
  const entityIdContent = auditEntityIdContentOf(entry);
  let entityIdValue: ReactNode;
  if (entityIdContent.kind === "null") {
    entityIdValue = tableLabels.noEntityIdValue;
  } else if (entityIdContent.kind === "accountLink") {
    entityIdValue = (
      <AuditAccountLink
        mono
        href={`/admin/users/${entityIdContent.userId}`}
        ariaLabel={`${tableLabels.userEntityLinkLabel} #${entityIdContent.userId}`}
      >
        {entityIdContent.userId}
      </AuditAccountLink>
    );
  } else {
    entityIdValue = entityIdContent.entityId;
  }

  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        p: 2,
      })}
    >
      <Stack spacing={1.25}>
        <WhenFact label={tableLabels.whenHeader} iso={entry.createdAt} locale={locale} />
        <CardFact
          label={tableLabels.actorHeader}
          value={
            <AuditAccountLink
              href={`/admin/users/${entry.actorId}`}
              ariaLabel={`${tableLabels.actorLinkLabel}: ${entry.actorName}`}
            >
              {entry.actorName}
            </AuditAccountLink>
          }
        />
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {tableLabels.actionHeader}
          </Typography>
          <Box component="span" sx={theme => actionChipSx(theme, entry.actionType)}>
            {actionLabels[entry.actionType]}
          </Box>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {tableLabels.entityTypeHeader}
          </Typography>
          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
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
        </Stack>
        <CardFact label={tableLabels.entityIdHeader} muted={entityIdContent.kind === "null"} value={entityIdValue} />
        {entry.details !== null ? (
          <Stack spacing={1}>
            <AuditDetailsDisclosure
              entryId={entry.id}
              details={entry.details}
              isExpanded={isExpanded}
              onToggleDetails={onToggleDetails}
              hideLabel={tableLabels.detailsHideLabel}
              showLabel={tableLabels.detailsShowLabel}
              alignFlexStart
            />
          </Stack>
        ) : (
          <CardFact label={tableLabels.detailsHeader} value={tableLabels.noDetailsValue} muted />
        )}
      </Stack>
    </Card>
  );
}

/** Mobile (< md) entry-card stack — see the module docblock. */
export function AuditTrailMobileCards(props: Readonly<AuditTrailMobileCardsProps>): ReactNode {
  return (
    <Stack spacing={2} sx={{ display: { xs: "flex", md: "none" } }} data-testid="audit-trail-mobile-cards">
      {props.entries.map(entry => (
        <AuditTrailCard
          key={entry.id}
          entry={entry}
          tableLabels={props.tableLabels}
          entityLabels={props.entityLabels}
          locale={props.locale}
          actionLabels={props.actionLabels}
          isExpanded={props.expandedDetailsId === entry.id}
          onToggleDetails={props.onToggleDetails}
        />
      ))}
    </Stack>
  );
}
