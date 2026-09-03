/**
 * SessionLifecycleService — pure pre-DB guards and normalizers (module
 * extraction, behavior-identical): the boundary vocabulary every flow
 * re-asserts BEFORE any database work, plus the read-side window and
 * filter normalizers. Nothing here touches the database, opens a
 * transaction, or logs — every function is pure (or throws the canonical
 * typed `VALIDATION` denial) and every mapping is a closed vocabulary.
 *
 * The public surface stays the `SessionLifecycleService` namespace in
 * `session-lifecycle.service.ts`: the flow methods delegate here for the
 * shared pre-DB checks so the entry points can never drift apart.
 * Nothing in this module is part of the public API.
 *
 * Members:
 *  - id-shape guards (`isPositiveSafeInteger` / `isPositiveSafeSessionId` /
 *    `assertPositiveSafeSessionId`) — a NaN, fractional, out-of-safe-range,
 *    non-positive, or non-number runtime identifier fails closed before any
 *    database work, so a garbage id can never reach SQL;
 *  - reason normalizers (`normalizeRequiredReasonText` /
 *    `normalizeOptionalReasonText`) — trim + length-guard, a whitespace-only
 *    optional reason maps to `null` (nothing is persisted for it);
 *  - probe-row status widenings (`SESSION_STARTED_STATUS` /
 *    `SESSION_COMPLETED_STATUS` / `SESSION_DISPUTED_STATUS`) — the probe
 *    row's `status` is the raw pg-enum string union, so comparisons use the
 *    enum member's string identity: the vocabulary still flows from the
 *    enum, never from a bare literal;
 *  - booking vocabulary (`sessionFeeForIntent` / `intentLaneFor`) — the
 *    platform fee constant (a decimal string carried verbatim, never a
 *    number, never arithmetic) and the provenance lane per bookable intent;
 *  - the claim-key unique-violation detector (`isClaimKeyUniqueViolation`);
 *  - list window/filter normalizers (`normalizePageBounds` /
 *    `normalizeAdminListBounds` / `guardStatusFilter`) — the read surface
 *    never fabricates a window and filters never error.
 */

import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ValidationError } from "@/backend/lib/errors";
import type { SessionListFilterInput, SessionStudentIntentType } from "@/backend/types";
import { SESSION_FEE_HIFZ, SESSION_FEE_TAJWEED } from "@/shared/constants/session-fees.constants";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/** The idempotency claim column's maximum key length (varchar(128) backstop). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/** A free-text reason/note longer than this is rejected before any DB work. */
const MAX_REASON_LENGTH = 500;

/** Default page size for the participant session lists. */
const DEFAULT_PAGE_SIZE = 25;

/** Inclusive upper page-size bound for the participant session lists. */
const MAX_PAGE_SIZE = 50;

/**
 * The in-progress status widened to a plain string: the probe row's status
 * is the raw pg-enum string union, so the comparison needs the enum
 * member's string identity without a runtime conversion — the vocabulary
 * still flows from the enum, never from a bare literal.
 */
export const SESSION_STARTED_STATUS: string = SessionStatus.Started;

/**
 * The disputed status widened to a plain string — the same probe-row
 * vocabulary treatment (the arbitration's pre-write probe compares against
 * this identity).
 */
export const SESSION_DISPUTED_STATUS: string = SessionStatus.Disputed;

/**
 * The completed status widened to a plain string — the same probe-row
 * vocabulary treatment (the dual-confirmation idempotence arm compares
 * against this identity).
 */
export const SESSION_COMPLETED_STATUS: string = SessionStatus.Completed;

/**
 * Resolves the platform fee constant for a bookable intent. The fee is a
 * decimal string carried verbatim into the insert — never a number, never
 * arithmetic.
 */
export function sessionFeeForIntent(intent: SessionStudentIntentType): string {
  return intent === SessionIntent.Hifz ? SESSION_FEE_HIFZ : SESSION_FEE_TAJWEED;
}

/**
 * Resolves the balance lane that funds a bookable intent's hold — the lane
 * the debit ladder falls back to when the trial lane is empty, and the
 * provenance recorded on the session row.
 */
export function intentLaneFor(intent: SessionStudentIntentType): HeldBalanceLane {
  return intent === SessionIntent.Hifz ? HeldBalanceLane.Hifz : HeldBalanceLane.Tajweed;
}

/** Positive safe-integer guard for caller-supplied identifiers (no casts). */
export function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * The target-session-id shape check for the four non-create paths:
 * a session id is valid ONLY as a positive safe integer — a NaN, fractional,
 * out-of-safe-range, non-positive, or non-number runtime value fails closed.
 * `unknown` is the honest parameter type: the GraphQL boundary parses the
 * `ID` argument shape-only (`Number(args.id)`), so the runtime value here is
 * NOT statically guaranteed to be a well-formed number — it may be the NaN,
 * fractional, or overflow shape that parse yields for a malformed string, or
 * a payload that skipped the boundary parse entirely.
 */
export function isPositiveSafeSessionId(id: unknown): boolean {
  return typeof id === "number" && isPositiveSafeInteger(id);
}

/**
 * Pre-DB `VALIDATION` denial for a malformed target session id on the three
 * mutation paths — the exact guard idiom `createSession` applies to its
 * participant ids, shared by all three transitions so the entry points can
 * never drift apart. The throw happens BEFORE any database work (before the
 * governance probe and the guarded UPDATE), so a garbage id can never reach
 * SQL (pg 22P02 → masked 500) and never spends a probe read.
 */
export function assertPositiveSafeSessionId(
  id: unknown,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): void {
  if (!isPositiveSafeSessionId(id)) {
    throw new ValidationError(t.validation);
  }
}

/**
 * Normalizes a REQUIRED free-text dispute reason: trims, then rejects
 * whitespace-only and over-limit content with the pre-DB `VALIDATION`
 * denial. The trimmed value is what the guarded UPDATE persists.
 */
export function normalizeRequiredReasonText(
  value: string,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REASON_LENGTH) {
    throw new ValidationError(t.validation);
  }
  return trimmed;
}

/**
 * Normalizes an OPTIONAL free-text reason/note (the cancel reason and the
 * arbitration note): trims, rejects over-limit content with the pre-DB
 * `VALIDATION` denial, and maps a whitespace-only value to `null` (nothing
 * is persisted for an empty contribution). The trimmed value is what the
 * guarded UPDATE persists.
 */
export function normalizeOptionalReasonText(
  value: string | null,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): string | null {
  const trimmed = value === null ? null : value.trim();
  if (trimmed !== null && trimmed.length > MAX_REASON_LENGTH) {
    throw new ValidationError(t.validation);
  }
  return trimmed !== null && trimmed.length > 0 ? trimmed : null;
}

/**
 * Detects the PostgreSQL unique-violation (`23505`) behind a thrown error by
 * traversing the cause chain (Drizzle wraps driver errors — the code lives
 * on a cause, never on the top-level wrapper). A cycle-safe `seen` set
 * guards against self-referential chains. The error MESSAGE is never
 * consulted.
 */
export function isClaimKeyUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Normalizes list pagination before any database work: a page below 1
 * (or a non-integer) falls back to the first page; a page size outside
 * 1..50 falls back to the default. The normalized values are what the
 * callers see echoed back — honest windows only.
 */
export function normalizePageBounds(page: number, pageSize: number): { page: number; pageSize: number } {
  const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const safePageSize =
    Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= MAX_PAGE_SIZE ? pageSize : DEFAULT_PAGE_SIZE;
  return { page: safePage, pageSize: safePageSize };
}

/**
 * Normalizes the admin arbitration list window before any database work —
 * the limit clamp mirrors the participant lists exactly (1..50, default 25)
 * and the offset floors at zero; `page` is the 1-based window index that
 * contains the requested offset, so the `limit`/`offset` window maps onto
 * the page echo honestly. Both normalize pre-DB, never error.
 */
export function normalizeAdminListBounds(
  limit: number,
  offset: number
): { safeLimit: number; safeOffset: number; page: number } {
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_PAGE_SIZE ? limit : DEFAULT_PAGE_SIZE;
  const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  return { safeLimit, safeOffset, page: Math.floor(safeOffset / safeLimit) + 1 };
}

/**
 * Guards the lifecycle filter against the closed status vocabulary before
 * any database work: absent/null members drop out, a lifecycle member
 * passes through as the bound filter value, and anything else drops out
 * too (filters never error — the owner predicate still scopes the read).
 */
export function guardStatusFilter(filter: SessionListFilterInput): SessionListFilterInput {
  const status = filter.status;
  if (status === undefined || status === null) {
    return { status: null };
  }
  if (!Object.values(SessionStatus).includes(status)) {
    return { status: null };
  }
  return { status };
}
