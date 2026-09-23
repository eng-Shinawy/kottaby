/**
 * Admin session-governance mutations — `adminRescheduleSession`,
 * `adminCancelSession`, `adminReassignTeacher`, and `adminJoinSession`.
 *
 * Contract:
 *  - `adminRescheduleSession(input: AdminSessionRescheduleInput!): Session!`
 *      Admin-only guarded retiming of a `scheduled`/`started` row. The
 *      timing pair rides the `DateTime` scalar (ISO-8601 on the wire);
 *      ordering and the past-grace window are validated by the service
 *      BEFORE any read.
 *  - `adminCancelSession(input: AdminSessionCancelInput!): Session!`
 *      Admin-only cancellation with the same-lane hold release. The
 *      request's idempotency key rides through VERBATIM exactly as
 *      captured by `createGraphQLContext` (`ctx.idempotencyKey`,
 *      PROPAGATION-ONLY per `docs/IDEMPOTENCY.md` + gateway Rule 3: never
 *      re-derived, never trimmed, never authorization-relevant); an
 *      absent header arrives as `null` and DISABLES the claim mechanism
 *      for the call (the service owns the key-shape guard), so an admin
 *      cancel without a key is a legitimate fire-and-forget operation —
 *      unlike booking, keying is optional here, never required.
 *  - `adminReassignTeacher(input: AdminSessionReassignInput!): Session!`
 *      Admin-only teacher swap on a `scheduled` row. The candidate's
 *      certification is asserted server-side under lock — the input
 *      carries identity only.
 *  - `adminJoinSession(input: AdminSessionJoinInput!): Session!`
 *      Admin-only observation join on a `started` row (audit-only — the
 *      session columns are never touched) returning the same canonical
 *      Session shape the participant read paths return.
 *
 * authScopes 401/403 split — byte-identical to `resolveSessionDispute`
 * (same `$all` conjunction, same builder scope wiring):
 *  - Anonymous callers hit the `authenticated` scope's UnauthorizedError
 *    throw (extensions.code UNAUTHORIZED / 401 — explicit throws pass
 *    through builder.ts's unauthorizedError mapping VERBATIM).
 *  - Authenticated wrong-role callers fail the `role` scope into the
 *    canonical localized ForbiddenError (FORBIDDEN / 403). A plain
 *    `{ authenticated, role }` map would combine with ANY semantics —
 *    the explicit `$all` conjunction is load-bearing.
 *  - The service re-asserts the governance-clean admin role from the user
 *    row as defense in depth (`assertAdminGovernanceClean` first statement
 *    of every method — the same gate `resolveSessionDispute` enforces).
 *
 * Resolvers are THIN DELEGATION ONLY (`backend/graphql/mutation/AGENTS.md`
 * + `backend/graphql/AGENTS.md`): no business logic, no repository calls,
 * no try/catch — DomainErrors from `SessionAdminGovernanceService`
 * propagate uncaught to the masking boundary with their `extensions.code`
 * untouched; all localized messaging happens inside the service via
 * `ctx.locale` propagation. Top-level static imports only.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — it registers root fields at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/classes/index.ts` →
 *    `mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  AdminSessionCancelPothosInput,
  AdminSessionJoinPothosInput,
  AdminSessionReassignPothosInput,
  AdminSessionReschedulePothosInput,
} from "@/backend/graphql/pothos/classes/admin-session-governance-input.pothos";
import { SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SessionAdminGovernanceService } from "@/backend/services";
import type {
  AdminSessionCancelInput,
  AdminSessionJoinInput,
  AdminSessionReassignInput,
  AdminSessionRescheduleInput,
} from "@/backend/types";

// Side-effect: register the `adminRescheduleSession` mutation field.
gqlSchemaBuilder.mutationField("adminRescheduleSession", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      input: t.arg({ type: AdminSessionReschedulePothosInput, required: true }),
    },
    description:
      "Reschedule one session's timing pair (admin-only guarded transition; scheduled/started rows only). Ordering and the past-grace window are validated before any read; zero-row misses are SESSION_INVALID_TRANSITION conflicts.",
    // Explicit `$all` conjunction per the 401/403 split documented above —
    // byte-identical to `resolveSessionDispute`'s admin gate.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message mirrors builder.ts's
      // own `authenticated` scope verbatim and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // BOPLA field-by-field mapping — the client whitelist is EXACTLY
      // `{ sessionId, startedAt, endedAt }` (`AdminSessionRescheduleInput`).
      // `sessionId` is a shape-only ID→number boundary parse the service
      // re-validates; the `DateTime` scalar has already parsed the timing
      // pair into `Date` instances.
      const input: AdminSessionRescheduleInput = {
        sessionId: Number(args.input.sessionId),
        startedAt: args.input.startedAt,
        endedAt: args.input.endedAt,
      };
      return SessionAdminGovernanceService.reschedule(ctx.user.id, input, ctx.locale);
    },
  })
);

// Side-effect: register the `adminCancelSession` mutation field.
gqlSchemaBuilder.mutationField("adminCancelSession", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      input: t.arg({ type: AdminSessionCancelPothosInput, required: true }),
    },
    description:
      "Cancel one session and release its held fee to the original lane (admin-only; pre-terminal rows only). Keyed retries with the same X-Idempotency-Key header are no-ops returning the current row — never a duplicate audit row nor a second refund.",
    // Explicit `$all` conjunction — same 401/403 split as
    // `adminRescheduleSession`.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `adminRescheduleSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // BOPLA field-by-field mapping — the client whitelist is EXACTLY
      // `{ sessionId, reason? }`. An absent/null GraphQL `String`
      // normalizes to "no reason" inside the service.
      const input: AdminSessionCancelInput = {
        sessionId: Number(args.input.sessionId),
        ...(args.input.reason === undefined || args.input.reason === null ? {} : { reason: args.input.reason }),
      };
      // Propagation-only idempotency key: consumed EXACTLY as captured at
      // the gateway. An absent header arrives as `null` and keeps that
      // value — the service treats a null key as claim-disabled (an
      // unkeyed admin cancel is legitimate). The key is never re-derived,
      // never trimmed, and never consultable by any authorization
      // decision.
      return SessionAdminGovernanceService.cancel(ctx.user.id, input, ctx.locale, ctx.idempotencyKey ?? null);
    },
  })
);

// Side-effect: register the `adminReassignTeacher` mutation field.
gqlSchemaBuilder.mutationField("adminReassignTeacher", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      input: t.arg({ type: AdminSessionReassignPothosInput, required: true }),
    },
    description:
      "Reassign one scheduled session to a different certified teacher (admin-only; scheduled rows only). The candidate's certification is asserted under lock — an unapproved candidate is TEACHER_NOT_CERTIFIED and leaves the row untouched.",
    // Explicit `$all` conjunction — same 401/403 split as
    // `adminRescheduleSession`.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `adminRescheduleSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // BOPLA field-by-field mapping — the client whitelist is EXACTLY
      // `{ sessionId, newTeacherUserId }`. Both ids are shape-only
      // ID→number boundary parses the service re-validates.
      const input: AdminSessionReassignInput = {
        sessionId: Number(args.input.sessionId),
        newTeacherUserId: Number(args.input.newTeacherUserId),
      };
      return SessionAdminGovernanceService.reassignTeacher(ctx.user.id, input, ctx.locale);
    },
  })
);

// Side-effect: register the `adminJoinSession` mutation field.
gqlSchemaBuilder.mutationField("adminJoinSession", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      input: t.arg({ type: AdminSessionJoinPothosInput, required: true }),
    },
    description:
      "Join one started session as a read-only observer (admin-only, audit-only — no session column changes). Rows that are not started are SESSION_INVALID_TRANSITION conflicts with zero audit rows.",
    // Explicit `$all` conjunction — same 401/403 split as
    // `adminRescheduleSession`.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `adminRescheduleSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // BOPLA field-by-field mapping — the client whitelist is EXACTLY
      // `{ sessionId }`; shape-only ID→number boundary parse.
      const input: AdminSessionJoinInput = {
        sessionId: Number(args.input.sessionId),
      };
      return SessionAdminGovernanceService.join(ctx.user.id, input, ctx.locale);
    },
  })
);
