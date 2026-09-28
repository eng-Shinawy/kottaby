import type { applicants } from "@/backend/db/schema/teachers/applicants";
import type { ApplicantCooldownState } from "@/backend/enum/teachers/applicant-cooldown-state.enum";
// NOTE: `ApplicantStatus` and `ApplicantCooldownState` are used ONLY at type
// positions in this file. The mandated value-import form is auto-normalized
// to `import type` by Biome `lint/style/useImportType` (safe fix applied by
// `biome check --write`). Runtime consumers (service guard validation /
// cooldown state derivation; the Pothos `gqlSchemaBuilder.enumType(…)`
// registrations) MUST keep their OWN value imports of the enums.
import type { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";

export type ApplicantSelectType = typeof applicants.$inferSelect;

/**
 * ApplicantProfileReturnType — canonical profile return shape for the
 * applicant lifecycle domain (produced by
 * `ApplicantLifecycleService.getMyApplicantProfile`, later exposed through
 * the Pothos `ApplicantProfile` object ref).
 *
 * Closed, readonly output shape: contains NO governance
 * fields, NO secrets, and NO client-writable fields (zero overlap with any
 * mutation input surface — BOPLA self-scope read-only data only).
 *
 * - `id` is the shared PK (= users.id).
 * - `status` re-applies the canonical `ApplicantStatus` TS enum over the raw
 *   varchar column (`applicants.status`, varchar(50), no pgEnum). Stored
 *   values are validated with `isApplicantStatus` at the service boundary
 *   (fail-closed) before any value carries this type.
 * - `cooldownActive` / `canPurchaseVerification` are computed server-side
 *   derivations, never mirrored from client input.
 * - `cooldownState` is the derived cooldown read-model vocabulary, computed
 *   server-side from `cooldownUntil` against the same captured instant that
 *   drives `cooldownActive` (strict `cooldownUntil > now` boundary).
 */
export interface ApplicantProfileReturnType {
  readonly id: number; // shared PK (= users.id)
  readonly status: ApplicantStatus; // guard-validated at service boundary
  readonly verificationAttempts: number;
  readonly lastAttemptAt: Date | null;
  readonly cooldownUntil: Date | null;
  readonly cooldownActive: boolean; // computed server-side
  readonly canPurchaseVerification: boolean; // computed server-side
  readonly cooldownState: ApplicantCooldownState; // derived server-side (none | active | expired)
}

/**
 * ApplicantCooldownExtensionAudit — the audit-trail contract for an admin
 * cooldown extension (composed by the lifecycle service, persisted through
 * the audit service inside the extension's transaction so the record shares
 * its commit/rollback fate).
 *
 * Carries the changed field NAME plus the old/new expiry ISO instants and
 * the extension length — never contact PII, credentials, or token values.
 */
export interface ApplicantCooldownExtensionAudit {
  readonly field: "cooldown_until";
  readonly from: string | null; // ISO instant of the prior cooldownUntil (null when none existed)
  readonly to: string; // ISO instant of the new cooldownUntil
  readonly additionalDays: number;
}

/**
 * ApplicantOverrideAudit — the audit-trail contract for a manual admin
 * override of an applicant's automated evaluation result (composed by the
 * lifecycle service, persisted through the audit service inside the
 * override's transaction so the record shares its commit/rollback fate, with
 * `action_type='override'`).
 *
 * One document per applied override, discriminated by `action`:
 *  - `certify`             → field `status`, from the guard-read prior status,
 *                            to `passed` (no cooldown members — the finalize
 *                            cleared whatever cooldown existed).
 *  - `reject`              → field `status`, from `passed` to `failed`, plus
 *                            the `cooldownUntil` ISO instant of the stamped
 *                            cooldown and the requested `cooldownDays`.
 *  - `grant_re_evaluation` → field `cooldown_until`, from the prior ISO
 *                            instant to `null` (cleared; status untouched).
 *
 * Carries field NAMES + instants + the requested length only — never contact
 * PII, credentials, or token values.
 */
export interface ApplicantOverrideAudit {
  readonly action: "certify" | "reject" | "grant_re_evaluation";
  readonly field: "status" | "cooldown_until";
  readonly from: string | null;
  readonly to: string | null;
  /** Reject only: ISO instant of the stamped cooldown. */
  readonly cooldownUntil?: string;
  /** Reject only: the requested cooldown length in whole days. */
  readonly cooldownDays?: number;
}
