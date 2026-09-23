"use client";

/**
 * AuditCopyEntityRefButton — the audit trail's per-row copy-entity-reference
 * quick action (the drawer rows' copy-id convention): writes the canonical
 * `<wireType> #<id>` reference to the clipboard, swaps the icon to a check
 * and tints the success color while the copied state is flagged (a 1.5s
 * transient that self-reverts), and keeps the click from bubbling.
 *
 * The copied value is deliberately the RAW wire type (not the localized
 * chip label): the reference is only useful when it can be pasted back into
 * the trail's entity-type filter or a `/audit?entityType=…` deep link —
 * both match the recorded wire string exactly.
 *
 * Failure posture mirrors `useCopyFeedback`: insecure contexts expose NO
 * Clipboard API at all and a rejected write stays silent — the button
 * never announces a copy that did not happen.
 */

import type { ReactNode } from "react";
import { CopyFeedbackIconButton } from "@/frontend/views/admin/directory-shared/CopyFeedbackIconButton";
import { useCopyFeedback } from "@/frontend/views/admin/directory-shared/useCopyFeedback";

interface AuditCopyEntityRefButtonProps {
  /** The raw entity-type wire value (copied verbatim, never localized). */
  readonly entityType: string;
  /** The entry's entity id (copied in the `#<id>` display format). */
  readonly entityId: string;
  /** The copy tooltip/aria label (resolved in the owning row). */
  readonly copyLabel: string;
  /** The post-copy tooltip label. */
  readonly copiedLabel: string;
}

export function AuditCopyEntityRefButton({
  entityType,
  entityId,
  copyLabel,
  copiedLabel,
}: Readonly<AuditCopyEntityRefButtonProps>): ReactNode {
  const { copied, copy } = useCopyFeedback();

  return (
    <CopyFeedbackIconButton
      copied={copied}
      copyLabel={copyLabel}
      copiedLabel={copiedLabel}
      ariaLabel={`${copyLabel}: ${entityType} #${entityId}`}
      onCopyClick={event => {
        // Copy only — the click must not also trigger a row-level action.
        event.stopPropagation();
        copy(`${entityType} #${entityId}`);
      }}
    />
  );
}
