"use client";

/**
 * AuditDetailsDisclosure — the shared expandable-details block used by BOTH
 * the desktop row (`AuditTrailRow`) and the mobile card
 * (`AuditTrailMobileCards`): a small text Button toggling the entry's
 * verbatim `details` JSON, rendered inside a `dir="auto"` pre-formatted
 * element (mixed-direction JSON blobs must not be re-flowed by bidi
 * rules) revealed through a height `Collapse` (unmounts when hidden; the
 * transition is a cheap height/opacity tween — no transform jank inside
 * the table row).
 *
 * Extracted so the two audit-trail renderers cannot drift apart — this
 * fragment is byte-shared by design (jscpd clone gate) and every label /
 * style change lands here exactly once.
 */

import { Box, Button, Collapse } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface AuditDetailsDisclosureProps {
  readonly entryId: string;
  /** The entry's verbatim details payload (non-null at every call site). */
  readonly details: string;
  readonly isExpanded: boolean;
  readonly onToggleDetails: (entryId: string) => void;
  readonly hideLabel: string;
  readonly showLabel: string;
  /**
   * Card layout needs the toggle pinned to the flex-start edge; the table
   * cell relies on the default stretch. Renderers stay visually identical.
   */
  readonly alignFlexStart?: boolean;
}

export function AuditDetailsDisclosure({
  entryId,
  details,
  isExpanded,
  onToggleDetails,
  hideLabel,
  showLabel,
  alignFlexStart = false,
}: Readonly<AuditDetailsDisclosureProps>): ReactNode {
  return (
    <>
      <Button
        size="small"
        variant="text"
        aria-expanded={isExpanded}
        onClick={() => onToggleDetails(entryId)}
        sx={{ ...focusVisibleRingSx, minHeight: 44, ...(alignFlexStart ? { alignSelf: "flex-start" } : {}) }}
      >
        {isExpanded ? hideLabel : showLabel}
      </Button>
      <Collapse in={isExpanded} unmountOnExit exit={false} timeout={220}>
        <Box
          component="pre"
          dir="auto"
          sx={theme => ({
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            color: theme.palette.text.secondary,
          })}
        >
          {details}
        </Box>
      </Collapse>
    </>
  );
}
