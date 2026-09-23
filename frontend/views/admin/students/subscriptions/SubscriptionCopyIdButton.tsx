"use client";

/**
 * SubscriptionCopyIdButton — the per-row copy-id quick action of the admin
 * student drawer's subscription rows (the directory's copy-email
 * convention): writes the `#<id>` value to the clipboard, swaps the icon
 * to a check and tints the success color while the copied state is flagged
 * (a 1.5s transient — the rows are dense, so the state self-reverts
 * instead of sticking), and keeps the click from bubbling.
 *
 * Failure posture mirrors `useCopyFeedback`: insecure contexts expose NO
 * Clipboard API at all and a rejected write stays silent — the button
 * never announces a copy that did not happen.
 */

import type { ReactNode } from "react";
import { CopyFeedbackIconButton } from "@/frontend/views/admin/directory-shared/CopyFeedbackIconButton";
import { useCopyFeedback } from "@/frontend/views/admin/directory-shared/useCopyFeedback";

interface SubscriptionCopyIdButtonProps {
  /** The subscription's wire id (copied in the `#<id>` display format). */
  readonly subscriptionId: string;
  /** The copy tooltip/aria label (resolved in the owning section). */
  readonly copyLabel: string;
  /** The post-copy tooltip label. */
  readonly copiedLabel: string;
}

export function SubscriptionCopyIdButton({
  subscriptionId,
  copyLabel,
  copiedLabel,
}: SubscriptionCopyIdButtonProps): ReactNode {
  const { copied, copy } = useCopyFeedback();

  return (
    <CopyFeedbackIconButton
      copied={copied}
      copyLabel={copyLabel}
      copiedLabel={copiedLabel}
      ariaLabel={`${copyLabel}: #${subscriptionId}`}
      onCopyClick={event => {
        // Copy only — the click must not also trigger a row-level action.
        event.stopPropagation();
        copy(`#${subscriptionId}`);
      }}
    />
  );
}
