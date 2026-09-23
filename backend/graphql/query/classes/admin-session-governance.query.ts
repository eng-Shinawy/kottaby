/**
 * Admin session-governance queries — the admin-only read surface over the
 * `session` entity: the filterable directory and the any-state browse
 * detail.
 *
 * Contract:
 *  - `adminSessions(filter: AdminSessionListFilterInput!, page: Int = 1,
 *    pageSize: Int = 25): SessionPage!`
 *      Every session row regardless of state or ownership, newest first,
 *      under the caller's filter set, paged with the honest total computed
 *      by the SAME filtered predicate. The rows carry the server-derived
 *      `needsAttention` badge (disputed, or scheduled with a lapsed
 *      confirmation deadline) — presentation-only styling input, never an
 *      authorization signal. The filter is REQUIRED on the wire but every
 *      member inside it is optional: absent members drop out of the
 *      repository predicate (filters never error); vocabulary members ride
 *      the registered Pothos enums (out-of-vocabulary values die at
 *      GraphQL validation, before any resolver runs).
 *  - `adminSession(id: ID!): Session`
 *      The row for ANY id regardless of lifecycle state (the browse view
 *      is read-only). A nonexistent id — and equally a malformed one —
 *      resolves to `null`, NEVER to a thrown not-found error: the browse
 *      plane answers "no such row" with data, preserving the distinction
 *      between the participant reads' id-probing discovery errors and this
 *      admin browse read.
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
 *    of both methods — the same gate `resolveSessionDispute` enforces).
 *
 * READ-ONLY guarantee: neither resolver writes ANYTHING — no session
 * mutation, no audit row, no notification receipt. The directory and the
 * detail are pure reads end to end (service → repository), so executing
 * them leaves the database byte-identical.
 *
 * Resolvers are THIN DELEGATION ONLY (`backend/graphql/AGENTS.md`): no
 * business logic, no repository calls, no try/catch — DomainErrors from
 * `SessionAdminGovernanceService` (the localized filter-shape validation)
 * propagate uncaught to the masking boundary with their `extensions.code`
 * untouched. Boundary decisions (filter vocabulary, page/pageSize bounds,
 * id shape) are the SERVICE's; the resolver forwards and maps, never
 * clamps or re-validates. Top-level static imports only.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired via side-effect barrels: `query/classes/index.ts` →
 *    `query/index.ts` → `gqlSchema.ts`.
 *  - `UserRole` is a VALUE import (scope decision input, never a type-only
 *    reference); `SessionPage`/`Session` reuse the canonical participant
 *    object types (single canonical object type per entity — no sibling
 *    types for the admin surface).
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionPagePothosObject, SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { AdminSessionListFilterPothosInput } from "@/backend/graphql/pothos/classes/session-filter-input.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SessionAdminGovernanceService } from "@/backend/services";
import type { AdminSessionListFilterInput } from "@/backend/types";

// Side-effect: register the `adminSessions` query field — the admin
// directory over EVERY session row regardless of state or ownership.
gqlSchemaBuilder.queryField("adminSessions", t =>
  t.field({
    type: SessionPagePothosObject,
    args: {
      // REQUIRED non-null filter (the admin directory has no "no filter"
      // wire shape — an empty input object is the explicit "everything"
      // request). Every member inside stays optional; the field-by-field
      // mapping below is the client whitelist.
      filter: t.arg({ type: AdminSessionListFilterPothosInput, required: true }),
      // SDL defaults (`page: Int = 1`, `pageSize: Int = 25`); the service
      // re-normalizes the effective bounds pre-DB and echoes them honestly
      // — the resolver forwards, never clamps. The `??` restores the
      // declared defaults when a client sends an EXPLICIT `null` (GraphQL
      // field defaults do not apply to explicit nulls).
      page: t.arg.int({ required: false, defaultValue: 1 }),
      pageSize: t.arg.int({ required: false, defaultValue: 25 }),
    },
    description:
      "List every session for the admin governance directory (admin-only): all rows regardless of state or ownership, newest first, paged with an honest total. Rows carry the server-derived needsAttention badge — presentation only, never an authorization signal.",
    // Explicit `$all` conjunction per the 401/403 split documented above —
    // byte-identical to `resolveSessionDispute`'s admin gate.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all { authenticated: true }` leg guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message mirrors builder.ts's
      // own `authenticated` scope verbatim and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // Field-by-field mapping — the client whitelist is EXACTLY the six
      // filter members of the canonical input (ids, vocabularies, the
      // half-open creation-instant window pair). The registry enums and
      // the `DateTime` scalar have already resolved the wire values onto
      // the canonical TS vocabulary and `Date` instances; pagination is
      // NOT part of the filter — the page/pageSize args above travel as
      // their own service arguments.
      // An EXPLICIT `null` member normalizes to `undefined` — the same
      // drop-out discipline as the participant filter (absent members fall
      // out of the repository predicate; filters never error).
      const filter: AdminSessionListFilterInput = {
        teacherUserId: args.filter.teacherUserId ?? undefined,
        studentUserId: args.filter.studentUserId ?? undefined,
        type: args.filter.type ?? undefined,
        status: args.filter.status ?? undefined,
        dateFrom: args.filter.dateFrom ?? undefined,
        dateTo: args.filter.dateTo ?? undefined,
      };
      return SessionAdminGovernanceService.listAll(
        ctx.user.id,
        filter,
        args.page ?? 1,
        args.pageSize ?? 25,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminSession` query field — the any-state
// browse read (read-only drawer/detail plane).
gqlSchemaBuilder.queryField("adminSession", t =>
  t.field({
    type: SessionPothosObject,
    // Nullable payload — `null` answers "no such row" (and equally a
    // malformed id) with data, never with a thrown not-found error.
    // The service guarantees the constant shape.
    nullable: true,
    args: {
      id: t.arg.id({ required: true }),
    },
    description:
      "Read one session for the admin browse detail (admin-only): the row for ANY id regardless of lifecycle state. Unknown and malformed ids resolve to null — the browse view answers absence with data, not with an error.",
    // Explicit `$all` conjunction — same 401/403 split as `adminSessions`.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `adminSessions` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric. The conversion is a pure scalar coercion — the service's
      // pre-read shape guard answers a malformed id with the SAME `null`
      // as a nonexistent id (the browse surface never throws for shape).
      return SessionAdminGovernanceService.getDetail(ctx.user.id, Number(args.id), ctx.locale);
    },
  })
);
