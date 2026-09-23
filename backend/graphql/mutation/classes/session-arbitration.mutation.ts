/**
 * Session arbitration mutations — `openPostConfirmationDispute` (the
 * post-confirmation dispute entry; the held-family arbitration partner
 * `resolveSessionDispute` stays registered in
 * `session-lifecycle.mutation.ts`, which now dispatches the two dispute
 * generations by outcome family).
 *
 * Contract:
 *  - `openPostConfirmationDispute(id: ID!, reason: String!): Session!`
 *      Any AUTHENTICATED caller (no role gate, mirroring
 *      `openSessionDispute`); the STUDENT-only predicate lives entirely
 *      service-side — the row moves into `disputed` only for its OWN
 *      student, so a non-student caller (the row's own teacher, a parent,
 *      an admin, a foreign student) and a nonexistent id are the SAME
 *      oracle-safe `SESSION_NOT_FOUND`. The `reason` is required and
 *      validated service-side (trimmed non-empty, ≤ 500, pre-DB
 *      `VALIDATION`); the target row must be a dual-confirmed `completed`
 *      session whose escrow was already consumed (`fee_held = false`) —
 *      anything else is the `SESSION_INVALID_TRANSITION` state conflict.
 *      The submission is exactly-once (the guarded write re-asserts the
 *      full predicate, so a concurrent double-submission is the
 *      state-conflict loser), zero audit rows are written (a participant
 *      action, mirroring the shipped pre-completion dispute), and the
 *      escrow/wallets stay untouched until arbitration.
 *
 * Resolver rules (`backend/graphql/mutation/AGENTS.md` +
 * `backend/graphql/AGENTS.md`):
 *  - THIN DELEGATION ONLY — no business logic, no repository calls, no
 *    try/catch: DomainErrors from `SessionArbitrationService` propagate
 *    uncaught to the masking boundary with their `extensions.code`
 *    untouched; all localized messaging happens inside the service via
 *    `ctx.locale` propagation.
 *  - Identity comes EXCLUSIVELY from the verified context (`ctx.user.id`;
 *    BOLA — the student caller is folded into the service's guarded write
 *    predicate, never accepted from the client).
 *  - NO outer transaction and NO notification handling: the service owns
 *    its single transaction (commit + the post-commit receipt publish of
 *    the dispute-opened admin wave) — the resolver adds nothing on either
 *    path.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — it registers the root field at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/classes/index.ts` →
 *    `mutation/index.ts` → `gqlSchema.ts`.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SessionArbitrationService } from "@/backend/services";

// Side-effect: register the `openPostConfirmationDispute` mutation field.
gqlSchemaBuilder.mutationField("openPostConfirmationDispute", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
      reason: t.arg({ type: "String", required: true }),
    },
    description:
      "Open a post-confirmation dispute on one of the caller's dual-confirmed sessions (student-only, exactly once, with a required reason). Non-students and nonexistent ids are indistinguishable SESSION_NOT_FOUND denials; a row that is not a confirmed completion with its escrow consumed is a SESSION_INVALID_TRANSITION conflict. The row waits in the disputed state for admin arbitration.",
    // `{ authenticated: true }` ONLY — the student-only predicate is
    // service-side (mirrors `openSessionDispute`/`cancelSession`): the
    // session's own student may dispute the dual-confirmed completion; every
    // other authenticated caller is denied by the service with the
    // oracle-safe SESSION_NOT_FOUND. A plain single-key map needs no `$all`
    // wrapper (no conjunction to force).
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // The `authenticated` scope guarantees a verified user row at
      // resolution time (anonymous callers never get past the scope step).
      // This branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly; the thrown message mirrors builder.ts's own
      // `authenticated` scope verbatim and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric (shape-only `Number` parse — every shape decision is the
      // SERVICE's id guard). The `reason` is a non-null GraphQL `String`;
      // the service validates/normalizes it pre-DB. The service call is
      // transaction-owning: no outer tx, and the dispute-opened wave's
      // receipts are published by the service itself after its own commit.
      return SessionArbitrationService.openPostConfirmationDispute(
        ctx.user.id,
        Number(args.id),
        args.reason,
        ctx.locale
      );
    },
  })
);
