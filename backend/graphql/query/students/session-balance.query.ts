/**
 * Student session-balance query — the caller's own prepaid session-credit
 * read.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/students/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (`backend/graphql/AGENTS.md`); no business logic inline.
 *
 * `mySessionBalance: StudentSessionBalance!`
 *  - ZERO arguments — identity is derived EXCLUSIVELY from the verified
 *    context (`ctx.user.id`). There is no caller-supplied lookup surface of
 *    any kind: BOLA probes that attempt to address a foreign id die as
 *    GraphQL validation failures before a resolver ever runs.
 *  - Student-only. A caller with no `students` row rejects with the
 *    localized `NotFoundError` (`STUDENT_NOT_FOUND`) produced by the
 *    service. The payload is the embedded four-lane value object — the
 *    prepaid session-credit counters with the honest column nullability
 *    (`balanceTrial` is the NOT NULL lane; the three purchased lanes expose
 *    their nullable columns verbatim) — and carries NO database identity.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth):
 *  - The field carries the EXPLICIT `$all` conjunction. Anonymous callers
 *    hit the `authenticated` scope's UnauthorizedError throw (extensions
 *    code UNAUTHORIZED / 401 — explicit scope throws pass through
 *    builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 *    callers with a wrong role (teacher, parent, supervisor, and admin)
 *    fail the `role` scope into the canonical localized ForbiddenError
 *    (FORBIDDEN / 403). A plain scope map would combine with ANY semantics
 *    and leak access — the conjunction is load-bearing.
 *  - NO admin/supervisor read override exists: the balance lanes are the
 *    student's private surface — admins and supervisors fail the role
 *    scope exactly like every other non-entitled role.
 *
 * DomainErrors thrown deeper (`STUDENT_NOT_FOUND`) propagate uncaught to
 * the masking boundary — NO try/catch here by contract (the boundary
 * finalizer owns masking + the single correlated log line). All imports
 * are top-level STATIC imports (Bun ESM rule — dynamic import expressions
 * in resolver trees are prohibited and fail the gateway's
 * static-assertions gate).
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { StudentSessionBalancePothosObject } from "@/backend/graphql/pothos/students/session-balance.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { StudentBalanceService } from "@/backend/services";

// Side-effect: register the `mySessionBalance` query field.
gqlSchemaBuilder.queryField("mySessionBalance", t =>
  t.field({
    type: StudentSessionBalancePothosObject,
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
      return StudentBalanceService.getMySessionBalance(ctx.user.id, ctx.locale);
    },
  })
);
