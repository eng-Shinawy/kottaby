"use client";

/**
 * SubscriptionCopyDigestButton — the section header's copy-digest quick
 * action: writes the pre-built plain-text digest to the clipboard and
 * flags the transient copied state through the shared `useCopyFeedback`
 * hook (a 1.5s auto-revert).
 *
 * Failure posture mirrors `useCopyFeedback`: insecure contexts expose NO
 * Clipboard API at all and a rejected write stays silent — the button
 * never announces a copy that did not happen.
 */
import type { ReactNode } from "react";
import { CopyFeedbackIconButton } from "@/frontend/views/admin/directory-shared/CopyFeedbackIconButton";
import { useCopyFeedback } from "@/frontend/views/admin/directory-shared/useCopyFeedback";

interface SubscriptionCopyDigestButtonProps {
  /** The pre-built digest text (composed by the owning section). */
  readonly digest: string;
  /** The copy tooltip/aria label (resolved in the owning section). */
  readonly copyLabel: string;
  /** The post-copy tooltip label. */
  readonly copiedLabel: string;
}

export function SubscriptionCopyDigestButton({
  digest,
  copyLabel,
  copiedLabel,
}: SubscriptionCopyDigestButtonProps): ReactNode {
  const { copied, copy } = useCopyFeedback();

  return (
    <CopyFeedbackIconButton
      copied={copied}
      copyLabel={copyLabel}
      copiedLabel={copiedLabel}
      ariaLabel={copyLabel}
      onCopyClick={copyDigestHandle(digest, copy)}
    />
  );
}

/** The digest click handler — copy-only, no bubbling contract to guard. */
function copyDigestHandle(digest: string, copy: (text: string) => void): () => void {
  return () => {
    copy(digest);
  };
}
