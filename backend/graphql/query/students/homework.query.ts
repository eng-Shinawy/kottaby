/**
 * Student homework query — the student's own homework history read.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/students/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer; no business logic inline.
 *
 * `myHomework(page: Int, pageSize: Int): ParentHomeworkPage!`
 *  - ZERO caller-supplied identity — the student identity is the verified
 *    context (`ctx.user.id`), exactly like `myStudentSessions` /
 *    `myHandshakeCode`: BOLA probes that attempt to address a foreign id
 *    die as GraphQL validation failures before a resolver ever runs.
 *  - Student-only surface (the student nav's homework entry).
 *  - The SDL return type is the parent portal's `ParentHomeworkPage` —
 *    the homework page projection is IDENTICAL by construction (the
 *    student's own rows pass through the SAME canonical row mapper the
 *    parent portal uses), so reusing the one canonical object trio
 *    (`ParentHomeworkPage`/`Entry`/`Track`) keeps a single wire shape
 *    where the list-and-grid discipline already shares it cross-role.
 *    The field name itself is role-neutral (`myHomework`), mirroring
 *    the `myStudentSessions` naming convention.
 *  - SDL page defaults (`page: Int = 1`, `pageSize: Int = 25`) are
 *    declared here; the `??` restores them when a client sends an
 *    EXPLICIT `null` (GraphQL field defaults do not apply to explicit
 *    nulls), and the service clamps the effective window pre-DB,
 *    echoing it honestly in the payload.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth):
 *  - The field carries the EXPLICIT `$all` conjunction (the proven
 *    pattern across every role-gated read). Anonymous callers hit the
 *    `authenticated` scope's UnauthorizedError throw (extensions.code
 *    UNAUTHORIZED / 401); authenticated callers with a wrong role fail
 *    the `role` scope into the canonical localized ForbiddenError
 *    (FORBIDDEN / 403). A plain scope map would combine with ANY
 *    semantics and leak access — the conjunction is load-bearing.
 *  - NO admin/teacher read override: homework history is the student's
 *    private surface (parents read it through the gated portal fields).
 *
 * DomainErrors thrown deeper: none — the read's terminal states are all
 * honest payloads (empty page, zero rows), so the resolver carries NO
 * try/catch by contract (the masking boundary owns unexpected internals).
 * All imports are top-level STATIC imports (Bun ESM rule).
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { ParentHomeworkPagePothosObject } from "@/backend/graphql/pothos/parents/parent-monitoring.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { StudentHomeworkService } from "@/backend/services";

// Side-effect: register the `myHomework` query field.
gqlSchemaBuilder.queryField("myHomework", t =>
  t.field({
    type: ParentHomeworkPagePothosObject,
    args: {
      // SDL defaults (`page: Int = 1`, `pageSize: Int = 25`); the service
      // re-normalizes the effective bounds pre-DB and echoes them honestly.
      page: t.arg.int({ required: false, defaultValue: 1 }),
      pageSize: t.arg.int({ required: false, defaultValue: 25 }),
    },
    description:
      "The caller's own homework rows (each carrying the two parallel Jadid/Madi track blocks), newest-session-first, paged. Track block composition preserves per-field nullability — a null grade stays null, a fully-null track block collapses to null, never fabricated zeros.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see the students-domain query header
      // (`myHandshakeCode`) for the verbatim-reachability note.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return StudentHomeworkService.listMyHomework(ctx.user.id, {
        page: args.page ?? undefined,
        pageSize: args.pageSize ?? undefined,
      });
    },
  })
);
