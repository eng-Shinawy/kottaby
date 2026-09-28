/**
 * Cooldown-extension helpers — pure functions extracted from
 * `useCooldownExtension` so the hook module stays under the `max-lines`
 * (150) cap for `frontend/views/**` files.
 */

import { extractErrorCode, extractErrorMessage } from "@/frontend/lib/graphql-error-utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

export type ExtensionCopy = AdminUsersLabels["applicantCooldownExtension"];
export type ExtensionInlineAlert = { readonly severity: "info" | "warning"; readonly message: string };

/** Mirrors the server-side bounds for the extension primitive (1..3650). */
export const EXTENSION_MIN_DAYS = 1;
export const EXTENSION_MAX_DAYS = 3650;

/**
 * Client mirror of the server-side bounds gate — an invalid value never
 * crosses the wire (same discipline as the suspend `periodDays` gate).
 */
export function isValidExtensionDays(raw: string): boolean {
  if (raw.trim() === "") return false;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= EXTENSION_MIN_DAYS && parsed <= EXTENSION_MAX_DAYS;
}

/**
 * Server-error → inline state mutation. Routing matrix for the extension
 * mutation's typed domain rejections:
 *  - `FORBIDDEN` → suppressed inline (rides the global toast path);
 *  - `APPLICANT_ALREADY_CERTIFIED` → info alert (certification is terminal —
 *    a state conflict, not an input problem);
 *  - any other code (`APPLICANT_COOLDOWN_EXTENSION_INVALID`,
 *    `APPLICANT_NOT_FOUND`, …) → info alert carrying the SERVER-localized
 *    message.
 */
export function buildExtensionRouteError(
  setDaysErr: (msg: string | null) => void,
  setAlert: (a: ExtensionInlineAlert | null) => void
): (err: unknown) => void {
  return err => {
    const code = extractErrorCode(err);
    if (code === "FORBIDDEN") return undefined;
    if (code === "VALIDATION") {
      // The generic VALIDATION class carries per-field payloads; the
      // extension mutation's bounds rejection uses its own typed code
      // instead, so this arm only fires for shared field-level validators.
      setDaysErr(extractErrorMessage(err));
      return undefined;
    }
    setAlert({ severity: "info", message: extractErrorMessage(err) ?? "" });
    return undefined;
  };
}
