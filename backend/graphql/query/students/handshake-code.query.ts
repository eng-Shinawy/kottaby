/**
 * Student handshake-code queries — the two role-gated read surfaces.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/students/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (`backend/graphql/AGENTS.md`); no business logic inline.
 *
 * `myHandshakeCode: String!`
 *  - ZERO arguments — identity is derived EXCLUSIVELY from the verified
 *    context (`ctx.user.id`). There is no caller-supplied lookup surface of
 *    any kind: BOLA probes that attempt to address a foreign id die as
 *    GraphQL validation failures before a resolver ever runs.
 *  - Student-only. A caller with no `students` row rejects with the localized
 *    `NotFoundError` (`STUDENT_NOT_FOUND`) produced by the service.
 *
 * `findStudentByHandshakeCode(code: String!): HandshakeCodeLookup`
 *  - Parent-only discovery. The code itself is the out-of-band capability
 *    (the legitimate parent learned it from the child) — the ONLY
 *    client-controllable input on either surface.
 *  - NULLABLE payload: a valid-format code matching no eligible student, and
 *    a governance-excluded child, BOTH answer `null` through one
 *    indistinguishable channel (never an error) — the service collapses them.
 *  - Malformed code → localized `ValidationError` (`VALIDATION`) thrown
 *    BEFORE any database read (service-internal, pre-DB).
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth):
 *  - Both fields carry the EXPLICIT `$all` conjunction. Anonymous callers hit
 *    the `authenticated` scope's UnauthorizedError throw (extensions.code
 *    UNAUTHORIZED / 401 — explicit scope throws pass through builder.ts's
 *    unauthorizedError mapping VERBATIM), while authenticated callers with a
 *    wrong role (including the sibling role on each query, teacher, and
 *    admin) fail the `role` scope into the canonical localized ForbiddenError
 *    (FORBIDDEN / 403). A plain scope map would combine with ANY semantics
 *    and leak access — the conjunction is load-bearing.
 *  - NO admin/supervisor read override exists on either surface: admins and
 *    supervisors fail the role scope exactly like every other non-entitled
 *    role.
 *
 * DomainErrors thrown deeper (`VALIDATION`, `STUDENT_NOT_FOUND`) propagate
 * uncaught to the masking boundary — NO try/catch here by contract (the
 * boundary finalizer owns masking + the single correlated log line). All
 * imports are top-level STATIC imports (Bun ESM rule — dynamic import
 * expressions in resolver trees are prohibited and fail the gateway's
 * static-assertions gate).
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { HandshakeCodeLookupPothosObject } from "@/backend/graphql/pothos/students/handshake-code.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { StudentHandshakeService } from "@/backend/services";

// Side-effect: register the `myHandshakeCode` query field.
gqlSchemaBuilder.queryField("myHandshakeCode", t =>
  t.field({
    type: "String",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, _args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message mirrors builder.ts's
      // own `authenticated` scope verbatim and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return StudentHandshakeService.getMyHandshakeCode(ctx.user.id, ctx.locale);
    },
  })
);

// Side-effect: register the `findStudentByHandshakeCode` query field.
gqlSchemaBuilder.queryField("findStudentByHandshakeCode", t =>
  t.field({
    type: HandshakeCodeLookupPothosObject,
    nullable: true,
    args: {
      code: t.arg({ type: "String", required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Parent],
      },
    },
    resolve: (_root, args, ctx) => StudentHandshakeService.findStudentByHandshakeCode(args.code, ctx.locale),
  })
);
