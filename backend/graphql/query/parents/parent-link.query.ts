/**
 * Parent-link request queries — the two role-gated read surfaces.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/parents/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (`backend/graphql/AGENTS.md`); no business logic inline.
 *
 * `myOutgoingParentLinkRequests: [OutgoingParentLinkRequest!]!`
 *  - Parent-only. ZERO arguments — identity is derived EXCLUSIVELY from the
 *    verified context (`ctx.user.id`). There is no caller-supplied lookup
 *    surface of any kind: BOLA probes that attempt to address a foreign id
 *    die as GraphQL validation failures before a resolver ever runs.
 *  - NON-paginated array: the service caps the listing at 50
 *    rows, newest first.
 *
 * `myIncomingParentLinkRequests: [IncomingParentLinkRequest!]!`
 *  - Student-only. Same zero-argument, context-only identity discipline and
 *    the same non-paginated array shape.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth):
 *  - Both fields carry the EXPLICIT `$all` conjunction (the proven pattern
 *    at `students/handshake-code.query.ts`). Anonymous callers hit the
 *    `authenticated` scope's UnauthorizedError throw (extensions.code
 *    UNAUTHORIZED / 401 — explicit scope throws pass through builder.ts's
 *    unauthorizedError mapping VERBATIM), while authenticated callers with
 *    a wrong role (including the sibling role on each query, teacher, and
 *    admin) fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403). A plain scope map would combine with
 *    ANY semantics and leak access — the conjunction is load-bearing.
 *  - NO admin/supervisor read override exists on either surface: link
 *    requests are a user-to-user handshake, so admins and supervisors fail
 *    the role scope exactly like every other non-entitled role.
 *
 * DomainErrors thrown deeper (the service's fresh actor re-check denials)
 * propagate uncaught to the masking boundary — NO try/catch here by
 * contract (the boundary finalizer owns masking + the single correlated
 * log line). All imports are top-level STATIC imports (Bun ESM rule —
 * dynamic import expressions in resolver trees are prohibited and fail the
 * gateway's static-assertions gate).
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  IncomingParentLinkRequestPothosObject,
  OutgoingParentLinkRequestPothosObject,
} from "@/backend/graphql/pothos/parents/parent-link-request.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { ParentLinkRequestService } from "@/backend/services";

// Side-effect: register the `myOutgoingParentLinkRequests` query field.
gqlSchemaBuilder.queryField("myOutgoingParentLinkRequests", t =>
  t.field({
    type: [OutgoingParentLinkRequestPothosObject],
    description:
      "Lists the caller's own parent-child link requests (newest first, capped). Rows keep their post-resolution status; expired rows are rendered without any write.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Parent],
      },
    },
    resolve: async (_root, _args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly. Unreachable in practice; per the
      // resolver-i18n rule the message flows through ctx.t (its en copy is
      // identical to builder.ts's `authenticated` scope literal).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentLinkRequestService.listMyOutgoing(ctx.user.id, ctx.locale);
    },
  })
);

// Side-effect: register the `myIncomingParentLinkRequests` query field.
gqlSchemaBuilder.queryField("myIncomingParentLinkRequests", t =>
  t.field({
    type: [IncomingParentLinkRequestPothosObject],
    description:
      "Lists the link requests addressed to the caller (newest first, capped). Rows keep their post-resolution status; expired rows are rendered without any write.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, _args, ctx) => {
      // TypeScript narrowing only — see the `myOutgoingParentLinkRequests`
      // note above.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentLinkRequestService.listMyIncoming(ctx.user.id, ctx.locale);
    },
  })
);
