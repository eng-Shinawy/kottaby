"use client";

/**
 * AuditEntityTypeQuickPick — the filter bar's entity-type quick-pick chip
 * row: one toggleable chip per canonical entity-type wire value, giving the
 * admin a one-tap path to the most common filters instead of typing the
 * recorded wire string into the free-text field (the chips fill the SAME
 * draft — the query still fires only on the enclosing form submit, so the
 * bar's contract is untouched).
 *
 * Active state mirrors the current `entityType` draft exactly (including a
 * hand-typed value outside the vocabulary — then every chip renders off);
 * tapping the active chip clears the draft. Chip visuals reuse the trail's
 * entity-chip system (per-entity icon, tertiary-container tint) so the
 * filter and the table read as one visual language, and the accessible
 * name carries BOTH the localized label and the canonical wire value the
 * filter will actually match.
 */

import { Box, Chip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { auditEntityTypeIconOf } from "@/frontend/views/admin/audit/audit-entity-type-icons";
import { ENTITY_TYPE_WIRE_VALUES, entityTypeLabelOf } from "@/frontend/views/admin/audit/audit-trail-filters";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface AuditEntityTypeQuickPickProps {
  /** The auditTrail label block — the chips' localized vocabulary. */
  readonly labels: AdminUsersLabels["auditTrail"];
  /** Caption line naming the chip group. */
  readonly caption: string;
  /** The current entity-type DRAFT value ("" = unfiltered). */
  readonly value: string;
  /** Draft updater — receives the wire value, or "" when the active chip is tapped. */
  readonly onChange: (nextValue: string) => void;
  /** Chips follow the fields' disabled posture (no data settled yet). */
  readonly disabled: boolean;
}

export function AuditEntityTypeQuickPick({
  labels,
  caption,
  value,
  onChange,
  disabled,
}: Readonly<AuditEntityTypeQuickPickProps>): ReactNode {
  return (
    <Box
      // Native `fieldset` — its implicit role IS `group`, so no ARIA role
      // attribute is needed (the default fieldset chrome is reset below).
      component="fieldset"
      aria-label={caption}
      sx={{ display: "flex", flexDirection: "column", gap: 1, border: 0, m: 0, p: 0, minWidth: 0 }}
    >
      <Typography
        variant="caption"
        component="p"
        sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}
      >
        {caption}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {ENTITY_TYPE_WIRE_VALUES.map(wireValue => {
          const active = value === wireValue;
          const localized = entityTypeLabelOf(labels, wireValue);
          return (
            <Chip
              key={wireValue}
              label={localized}
              icon={auditEntityTypeIconOf(wireValue)}
              variant={active ? "filled" : "outlined"}
              color={active ? "primary" : undefined}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(active ? "" : wireValue)}
              // The accessible name pairs the localized label with the
              // canonical wire value — the string the filter actually
              // matches (screen-reader parity with the visible hint).
              aria-label={`${localized} (${wireValue})`}
              sx={theme => ({
                ...focusVisibleRingSx,
                minHeight: 44,
                borderRadius: 999,
                ...(active
                  ? {}
                  : {
                      backgroundColor: theme.palette.tertiaryContainer,
                      color: theme.palette.onTertiaryContainer,
                    }),
              })}
            />
          );
        })}
      </Box>
    </Box>
  );
}
