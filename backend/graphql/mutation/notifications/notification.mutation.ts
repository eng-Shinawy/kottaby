/**
 * Notification inbox mutations — `markNotificationRead` +
 * `markAllNotificationsRead`.
 *
 * Contract:
 *  - `markNotificationRead(id: ID!): Notification!`
 *      Marks exactly ONE of the caller's own notifications read (the
 *      one-directional read latch) and returns the row. The guarded UPDATE
 *      keys on `(id, user_id)`, so a foreign id and a nonexistent id are
 *      INDISTINGUISHABLE — both surface the localized NOTIFICATION_NOT_FOUND
 *      error with no existence oracle. Marking an already-read row is
 *      idempotent (the row returns unchanged, no state drift).
 *  - `markAllNotificationsRead(type: NotificationType): Int!`
 *      Marks every UNREAD row of the caller read — one set-based UPDATE,
 *      optionally narrowed to a single notification kind — and returns the
 *      affected-row count. An empty matching set is NOT an error (returns 0);
 *      a repeat sweep reports 0 (already-read rows never match again).
 *
 * Scope semantics (every authenticated role owns an inbox — no role,
 * permission, or superAdmin scope participates):
 *  - BOTH fields carry EXACTLY `authScopes: { authenticated: true }`. Anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 semantics — explicit throws pass
 *    through builder.ts's unauthorizedError mapping VERBATIM).
 *
 * Thin-resolver discipline:
 *  - Bodies delegate to `NotificationEngine.markRead` / `markAllRead` with
 *    `ctx.user.id` + `ctx.locale` — no business logic, no repository imports.
 *    Identity is derived EXCLUSIVELY from the verified context; neither
 *    operation accepts an identity argument of any kind (BOLA probes die as
 *    GraphQL validation failures before a resolver ever runs).
 *  - ID-channel discipline for `markNotificationRead`: the GraphQL ID arrives
 *    as a string or number, so the resolver parses it through the
 *    positive-safe-int guard (`isPositiveSafeInt` — never an `as number`
 *    narrowing) plus a bounded canonical wire-form check (no sign, no
 *    exponent, no leading zeros, no trailing garbage). A malformed shape
 *    parses to NaN, which the engine's own pre-DB gate rejects with the
 *    localized ValidationError — "12abc" can never silently address row 12.
 *    The engine re-validates the same bound as defense-in-depth.
 *  - `ctx.locale` propagates on every call so localized errors resolve
 *    through the service's translation seam.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — the root fields register at import time
 *    via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/notifications/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { NotificationPothosObject } from "@/backend/graphql/pothos/notifications/notification.pothos";
import { NotificationTypePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";

/**
 * Wire-form guard for the `id` argument: the canonical decimal representation
 * of a positive integer (ASCII digits only — no sign, exponent, decimal
 * point, leading zeros, surrounding whitespace, or trailing garbage).
 */
const CANONICAL_POSITIVE_INT_ID = /^[1-9]\d*$/;

/** The value that FAILS the engine's positive-safe-int pre-DB gate. */
const INVALID_NOTIFICATION_ID = Number.NaN;

/**
 * Parses the `markNotificationRead` id argument into its numeric form through
 * the positive-safe-int guard (never an `as number` narrowing).
 *
 * The GraphQL ID arrives as a string or a number (Pothos models both input
 * coercions): a number passes straight through `isPositiveSafeInt`; a string
 * must be the canonical positive-integer form and parse into the safe range.
 * Every other shape — hostile strings like `"12abc"`, `"1.5"`, `"1e3"`,
 * non-ASCII digit spellings, or out-of-range magnitudes — yields NaN, the
 * value the engine's own pre-DB gate rejects with the localized
 * ValidationError. The rejection keeps its single construction site in the
 * service boundary; this guard merely guarantees a malformed wire form can
 * never silently address a different row than the client asked for.
 */
function parseNotificationIdArg(rawId: string | number): number {
  if (typeof rawId === "number") {
    return isPositiveSafeInt(rawId) ? rawId : INVALID_NOTIFICATION_ID;
  }
  if (!CANONICAL_POSITIVE_INT_ID.test(rawId)) {
    return INVALID_NOTIFICATION_ID;
  }
  const parsed = Number.parseInt(rawId, 10);
  return isPositiveSafeInt(parsed) ? parsed : INVALID_NOTIFICATION_ID;
}

// Side-effect: register the `markNotificationRead` mutation field.
gqlSchemaBuilder.mutationField("markNotificationRead", t =>
  t.field({
    type: NotificationPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
    },
    description:
      "Marks one of the caller's own notifications read (idempotent) and returns the row. A foreign or nonexistent id is indistinguishable — NOTIFICATION_NOT_FOUND with no existence oracle.",
    // Requires an authenticated context (UNAUTHORIZED otherwise) — every
    // authenticated role owns an inbox, so no role/permission scope applies.
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // The `authenticated` scope guarantees a verified user row at
      // resolution time (anonymous callers never get past the scope step).
      // This branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly. Unreachable in practice; per the resolver-i18n
      // rule the message flows through ctx.t (its en copy is identical to
      // builder.ts's `authenticated` scope literal).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // ID-channel discipline: canonical wire-form guard here; the engine's
      // positive-safe-int gate owns the pre-DB rejection (see file docs).
      return NotificationEngine.markRead(ctx.user.id, parseNotificationIdArg(args.id), ctx.locale);
    },
  })
);

// Side-effect: register the `markAllNotificationsRead` mutation field.
gqlSchemaBuilder.mutationField("markAllNotificationsRead", t =>
  t.field({
    type: "Int",
    args: {
      type: t.arg({ type: NotificationTypePothosEnum, required: false }),
    },
    description:
      "Marks every unread notification of the caller read (optionally narrowed to one type) and returns the affected-row count. An empty matching set returns 0; repeat sweeps are idempotent (0).",
    // Requires an authenticated context (UNAUTHORIZED otherwise) — every
    // authenticated role owns an inbox, so no role/permission scope applies.
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the `markNotificationRead` note above.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // The optional enum filter forwards as-is; the engine's enum guard is
      // the defense-in-depth re-validation (non-schema transports).
      return NotificationEngine.markAllRead(ctx.user.id, args.type ?? null, ctx.locale);
    },
  })
);
