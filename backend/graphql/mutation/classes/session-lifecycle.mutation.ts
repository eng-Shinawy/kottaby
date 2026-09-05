/**
 * Session lifecycle mutations — `createSession`, `startSession`,
 * `completeSession`, `cancelSession`, `openSessionDispute`,
 * `resolveSessionDispute`, and `confirmSessionCompletion` (the dispute
 * pair + the dual-confirmation completion).
 *
 * Contract:
 *  - `createSession(input: CreateSessionInput!): Session!`
 *      Student-only (`$all` scope conjunction). Books one session against
 *      a certified teacher. The student identity is resolved SERVER-side
 *      from `ctx.user.id` — never client-supplied (BOLA). The request's
 *      idempotency key rides through VERBATIM exactly as captured by
 *      `createGraphQLContext` (`ctx.idempotencyKey`, PROPAGATION-ONLY per
 *      `docs/IDEMPOTENCY.md` + gateway Rule 3: never re-derived, never
 *      trimmed, never authorization-relevant); a missing/empty key fails
 *      `VALIDATION` service-side, pre-DB.
 *  - `startSession(id: ID!): Session!` / `completeSession(id: ID!): Session!`
 *      Teacher-only guarded transitions. `id` parsing at this
 *      boundary is shape-only (`Number`); the service re-validates it as a
 *      positive safe integer and classifies every zero-row miss (unknown ≡
 *      foreign ≡ `SESSION_NOT_FOUND`; wrong state →
 *      `SESSION_INVALID_TRANSITION`; decertified complete →
 *      `TEACHER_NOT_CERTIFIED`).
 *  - `cancelSession(id: ID!, reason: String): Session!`
 *      Any AUTHENTICATED caller (no role gate); the
 *      participant predicate lives entirely service-side. A non-participant
 *      (parent/admin included — NO bypass) and a nonexistent id are
 *      indistinguishable `SESSION_NOT_FOUND` denials (oracle-safe). The
 *      optional `reason` is validated, trimmed, and persisted by the
 *      service into `cancel_reason`.
 *  - `openSessionDispute(id: ID!, reason: String!): Session!`
 *      Any AUTHENTICATED caller (no role gate, mirroring `cancelSession`);
 *      the participant predicate lives entirely service-side — a
 *      non-participant (admin/parent included) and a nonexistent id are the
 *      SAME oracle-safe `SESSION_NOT_FOUND`. The `reason` is required and
 *      validated service-side (trimmed non-empty, ≤ 500, pre-DB
 *      `VALIDATION`); the row moves `scheduled|started → disputed` exactly
 *      once (wrong state → `SESSION_INVALID_TRANSITION`).
 *  - `resolveSessionDispute(id: ID!, resolution: DisputeResolution!, note: String): Session!`
 *      Admin-only (`$all` conjunction — authenticated wrong-role callers
 *      fail the `role` leg into the canonical localized FORBIDDEN); the
 *      service re-asserts the admin role + governance from the user row as
 *      defense in depth. The arbitration resolves a `disputed` row into
 *      exactly one terminal state (`Cancel` → refund via the same-lane
 *      primitive; `Complete` → hold consumed, never-started rows are
 *      pre-DB `VALIDATION` denials).
 *
 * authScopes 401/403 split (mirrors `query/teachers/applicant.query.ts`,
 * verified against @pothos/plugin-scope-auth@4.1.7):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`), so ANY authenticated caller would pass.
 *  - The conjunction is therefore made EXPLICIT with `$all`: anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 — explicit throws pass through
 *    builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 *    wrong-role callers fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403). On `createSession` the denial is
 *    unconditional: teacher-role callers (certified OR applicant) are
 *    always FORBIDDEN — an honest denial, never an existence oracle.
 *
 * Resolvers are THIN DELEGATION ONLY (`backend/graphql/mutation/AGENTS.md`
 * + `backend/graphql/AGENTS.md`): no business logic, no repository calls,
 * no try/catch — DomainErrors from `SessionLifecycleService` propagate
 * uncaught to the masking boundary with their `extensions.code` untouched;
 * all localized messaging happens inside the service via
 * `ctx.locale` propagation. Top-level static imports only.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — it registers root fields at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/classes/index.ts` →
 *    `mutation/index.ts` → `gqlSchema.ts`.
 */

import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { CreateSessionInput } from "@/backend/graphql/pothos/classes/create-session-input.pothos";
import { SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { DisputeResolutionPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services";
import type { SessionSubmitInput } from "@/backend/types";

// Side-effect: register the `createSession` mutation field.
gqlSchemaBuilder.mutationField("createSession", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      input: t.arg({ type: CreateSessionInput, required: true }),
    },
    description:
      "Book one session against a certified teacher. Student-only; the booking is idempotent per the X-Idempotency-Key request header (a replayed key surfaces DUPLICATE_REQUEST).",
    // Explicit `$all` conjunction per the 401/403 split documented above.
    // Teacher-role callers (certified or applicant) fail the `role` leg —
    // the unconditional FORBIDDEN.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
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
      // `{ teacherId, intent }` (`SessionSubmitInput`). The SDL enum carries
      // the full `SessionIntent` vocabulary, and the booking-out-of-
      // vocabulary member (`evaluation`) must REACH the service's runtime
      // guard (`VALIDATION` + `invalidSessionIntent`, pre-DB).
      // The compiler cannot see that value (`SessionSubmitInput` narrows to
      // the bookable pair), so the runtime value is overlaid onto a
      // correctly-typed base via Object.assign — an intent-overlay typing
      // residual tracked for future typing work, using the codebase's
      // lint-clean mechanism for deliberate hostile-value propagation (the
      // same pattern the service suite uses to prove the guard). No unsafe
      // assertion, no local type, no branching; `teacherId` is a shape-only
      // ID→number boundary parse the service re-validates.
      const baseInput: SessionSubmitInput = {
        teacherId: Number(args.input.teacherId),
        intent: SessionIntent.Hifz,
      };
      const input: SessionSubmitInput = Object.assign(baseInput, { intent: args.input.intent });
      // Propagation-only idempotency key: consumed EXACTLY as captured at
      // the gateway. An absent header arrives as `null` and coalesces to
      // "" solely to satisfy the service's string parameter — the empty key
      // hits the service's own `idempotencyKeyRequired` guard (VALIDATION,
      // pre-DB). The key is never re-derived, never trimmed, and never
      // consultable by any authorization decision.
      return SessionLifecycleService.createSession(ctx.user.id, input, ctx.idempotencyKey ?? "", ctx.locale);
    },
  })
);

// Side-effect: register the `startSession` mutation field.
gqlSchemaBuilder.mutationField("startSession", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
    },
    description: "Start one of the caller's scheduled sessions (teacher-only guarded transition).",
    // Explicit `$all` conjunction — same 401/403 split as `createSession`.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return SessionLifecycleService.startSession(ctx.user.id, Number(args.id), ctx.locale);
    },
  })
);

// Side-effect: register the `completeSession` mutation field.
gqlSchemaBuilder.mutationField("completeSession", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
    },
    description:
      "Complete one of the caller's started sessions (teacher-only; certification is re-asserted inside the guarded UPDATE).",
    // Explicit `$all` conjunction — same 401/403 split as `createSession`.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return SessionLifecycleService.completeSession(ctx.user.id, Number(args.id), ctx.locale);
    },
  })
);

// Side-effect: register the `cancelSession` mutation field.
gqlSchemaBuilder.mutationField("cancelSession", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
      reason: t.arg({ type: "String", required: false }),
    },
    description:
      "Cancel one of the caller's scheduled/started sessions (either participant) and release the held fee to its original lane. Non-participants and nonexistent ids are indistinguishable SESSION_NOT_FOUND denials.",
    // `{ authenticated: true }` ONLY — the participant predicate is
    // service-side: both participants may cancel; every other
    // authenticated role (incl. parent/admin) is denied by the service with
    // the oracle-safe SESSION_NOT_FOUND. A plain single-key map needs no
    // `$all` wrapper (no conjunction to force).
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return SessionLifecycleService.cancelSession(ctx.user.id, Number(args.id), args.reason ?? null, ctx.locale);
    },
  })
);

// Side-effect: register the `openSessionDispute` mutation field.
gqlSchemaBuilder.mutationField("openSessionDispute", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
      reason: t.arg({ type: "String", required: true }),
    },
    description:
      "Open a dispute on one of the caller's scheduled/started sessions (either participant, exactly once, with a required reason). Non-participants and nonexistent ids are indistinguishable SESSION_NOT_FOUND denials; the row waits in the disputed state for admin arbitration.",
    // `{ authenticated: true }` ONLY — the participant predicate is
    // service-side (mirrors `cancelSession`): both participants may dispute
    // their row; every other authenticated role (incl. parent/admin) is
    // denied by the service with the oracle-safe SESSION_NOT_FOUND. A plain
    // single-key map needs no `$all` wrapper (no conjunction to force).
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric (shape-only `Number` parse — every shape decision is the
      // SERVICE's id guard). The `reason` is a non-null GraphQL
      // `String`; the service validates/normalizes it pre-DB.
      return SessionLifecycleService.openSessionDispute(ctx.user.id, Number(args.id), args.reason, ctx.locale);
    },
  })
);

// Side-effect: register the `resolveSessionDispute` mutation field.
gqlSchemaBuilder.mutationField("resolveSessionDispute", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
      resolution: t.arg({ type: DisputeResolutionPothosEnum, required: true }),
      note: t.arg({ type: "String", required: false }),
    },
    description:
      "Resolve one disputed session into exactly one terminal state (admin arbitration): Cancel refunds the held fee to its original lane, Complete consumes the hold (never-started disputes are rejected). Non-disputed rows are SESSION_INVALID_TRANSITION conflicts.",
    // Explicit `$all` conjunction per the 401/403 split documented above:
    // anonymous callers hit UNAUTHORIZED (401), authenticated non-admins
    // fail the `role` leg into the canonical localized FORBIDDEN (403).
    // The service additionally re-asserts the admin role + governance from
    // the user row (defense in depth).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return SessionLifecycleService.resolveSessionDispute(
        ctx.user.id,
        Number(args.id),
        args.resolution,
        args.note ?? null,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `confirmSessionCompletion` mutation field.
gqlSchemaBuilder.mutationField("confirmSessionCompletion", t =>
  t.field({
    type: SessionPothosObject,
    args: {
      id: t.arg({ type: "ID", required: true }),
    },
    description:
      "Confirm a completed session as its student (the teacher's stamp is written by completion), completing the dual confirmation: the escrow hold is consumed and the teacher's wallet is credited exactly once. Repeat confirms, the teacher caller, and arbitration-settled rows are idempotent no-ops returning the current row. Non-participants and nonexistent ids are indistinguishable SESSION_NOT_FOUND denials.",
    // `{ authenticated: true }` ONLY — the participant predicate is
    // service-side (mirrors `cancelSession`/`openSessionDispute`): both
    // participants may act on their row; every other authenticated role
    // (incl. parent/admin) is denied by the service with the oracle-safe
    // SESSION_NOT_FOUND. A plain single-key map needs no `$all` wrapper.
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createSession` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string on the wire; the service boundary is
      // numeric (shape-only `Number` parse — every shape decision is the
      // SERVICE's id guard).
      return SessionLifecycleService.confirmSessionCompletion(ctx.user.id, Number(args.id), ctx.locale);
    },
  })
);
