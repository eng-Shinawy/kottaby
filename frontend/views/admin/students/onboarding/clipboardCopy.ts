/**
 * copyTextToClipboard — the onboarding dialog's ONE clipboard seam.
 *
 * Prefers the async Clipboard API (secure contexts) and degrades to the
 * legacy `execCommand("copy")` bridge when the write is denied (permission
 * policies, embedded webviews, automation browsers): the temporary
 * textarea keeps the handoff text off-screen while the synthetic copy
 * command lifts it into the clipboard. The boolean result lets the caller
 * drive honest feedback — a failed copy renders the manual-select hint
 * instead of a false "copied" confirmation.
 *
 * Best-effort by design: nothing here throws — every failure mode
 * resolves to `false` so the caller's state machine stays total.
 */

/** The off-screen textarea contract: invisible, unfocusable, one-shot. */
const LEGACY_COPY_STYLE = "position: fixed; top: -9999px; left: -9999px; opacity: 0; pointer-events: none;";

/** Legacy bridge — a temporary textarea + the synthetic copy command. */
const legacyCopyViaExecCommand = (text: string): boolean => {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("style", LEGACY_COPY_STYLE);
    textarea.setAttribute("aria-hidden", "true");
    textarea.setAttribute("readonly", "readonly");
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
};

/**
 * Copies `text` to the clipboard, resolving to `true` on success.
 * Tries the async API first, then the legacy bridge on any denial.
 */
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Permission-denied / insecure-context — fall through to the bridge.
  }
  return legacyCopyViaExecCommand(text);
};
