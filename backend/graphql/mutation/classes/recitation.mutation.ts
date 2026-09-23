/**
 * Recitation record mutation — `setSessionRecitation`.
 *
 * Contract:
 *  - `setSessionRecitation(sessionId: ID!, input: SessionRecitationInput!): SessionRecitation!`
 *      Teacher-only. Records the write-once recitation of a HAPPENED
 *      session as its owning teacher. The acting identity is resolved
 *      SERVER-side from `ctx.user.id` — never client-supplied (BOLA). The
 *      return is NON-NULLABLE: a successful call ALWAYS returns the created
 *      row (every denial throws). The owning session id arrives as its own
 *      `ID!` argument — never part of the input whitelist.
 *
 * authScopes 401/403 split (mirrors
 * `mutation/classes/session-lifecycle.mutation.ts`, verified against the
 * Pothos scope-auth plugin semantics):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (the builder's `defaultStrategy`), so ANY authenticated caller would
 *    pass through the first satisfied scope and wrong-role callers would be
 *    granted access. The conjunction is therefore made EXPLICIT with `$all`:
 *    anonymous callers hit the `authenticated` scope's UnauthorizedError
 *    throw (extensions.code UNAUTHORIZED / 401 — explicit throws pass
 *    through builder.ts's unauthorizedError mapping VERBATIM), while
 *    authenticated non-teachers fail the `role` scope into the canonical
 *    localized ForbiddenError (FORBIDDEN / 403).
 *
 * Resolver body is THIN DELEGATION (`backend/graphql/mutation/AGENTS.md`
 * + `backend/graphql/AGENTS.md`):
 *  - BOPLA field-by-field mapping ONLY — the client whitelist is EXACTLY
 *    `{ name, description }` (`SessionRecitationSubmitInput`); the absent
 *    `description` coalesces to an explicit `null` (never `undefined`,
 *    never the raw input object — no spread). Every server-controlled
 *    value (row id, owning session, timestamps) is resolved server-side.
 *  - `ID` arrives as a string on the wire; the service boundary is numeric.
 *    Only a positive decimal-integer string coerces — a lazy parse ("1e0",
 *    "0x1") would silently misroute the write, so a non-decimal id arrives
 *    at the service as NaN and dies in its pre-DB shape guard. Every shape
 *    decision beyond that wire syntax (the positive-safe-integer id guard,
 *    ownership, writeability, write-once arbiter) is the SERVICE's; no
 *    error code is named here.
 *  - The request locale propagates so the service owns all localized
 *    denial copy. The optional outer-transaction seam stays omitted: the
 *    top-level wire flow runs on the service's own transaction.
 *  - No business logic, no repository calls, no try/catch — DomainErrors
 *    from `RecitationRecordService` propagate uncaught to the masking
 *    boundary with their `extensions.code` untouched. Top-level static
 *    imports only.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — it registers the root field at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/classes/index.ts` →
 *    `mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  SessionRecitationInput,
  SessionRecitationPothosObject,
} from "@/backend/graphql/pothos/classes/recitation.pothos";
import { coerceDecimalSessionId, requireVerifiedUser } from "@/backend/graphql/shared";
import { RecitationRecordService } from "@/backend/services";
import type { SessionRecitationSubmitInput } from "@/backend/types";

// Side-effect: register the `setSessionRecitation` mutation field.
gqlSchemaBuilder.mutationField("setSessionRecitation", t =>
  t.field({
    type: SessionRecitationPothosObject,
    // A successful call ALWAYS returns the created row — every denial
    // throws, so the resolved payload is never null.
    nullable: false,
    // Explicit `$all` conjunction per the 401/403 split documented above
    // (plain key-map = ANY semantics — known-wrong pattern): anonymous
    // callers hit UNAUTHORIZED (401), authenticated non-teachers fail the
    // `role` leg into the canonical localized FORBIDDEN (403).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    args: {
      sessionId: t.arg.id({ required: true }),
      input: t.arg({ type: SessionRecitationInput, required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireVerifiedUser(ctx);
      // BOPLA field-by-field mapping — NEVER `{ ...args.input }`. The
      // absent optional note normalizes to an explicit `null` to satisfy
      // the service's submission whitelist. The optional outer-transaction
      // seam stays OMITTED: the top-level wire flow runs on the service's
      // own transaction (that parameter is for transactional callers).
      // The shared coercion guard admits only a positive decimal-integer
      // wire id — a lazy parse ("1e0", "0x1") would silently misroute the
      // write, so a non-decimal id arrives at the service as NaN and dies
      // in its pre-DB VALIDATION shape guard.
      return RecitationRecordService.setSessionRecitation(
        user.id,
        coerceDecimalSessionId(args.sessionId),
        {
          name: args.input.name,
          description: args.input.description ?? null,
        } satisfies SessionRecitationSubmitInput,
        ctx.locale
      );
    },
  })
);
