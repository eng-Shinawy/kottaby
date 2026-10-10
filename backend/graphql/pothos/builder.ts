/**
 * Pothos SchemaBuilder — the single, project-wide instance for the code-first
 * GraphQL schema.
 *
 * Plugins loaded:
 *  - `with-input`  — enables `t.inputType(...)` / `t.arg({ type: ... })`
 *    patterns for mutation inputs.
 *  - `scope-auth`  — enables `authScopes: { ... }` on every field. Loaded
 *    here so resolvers can apply `{ authenticated: true }`, `{ role: [...] }`,
 *    `{ permission: [...] }`, `{ superAdmin: true }`, and
 *    `{ notImpersonating: true }` scopes. The `authScopes` initializer maps
 *    each scope key to a decision based on the GraphQL `Context` (populated
 *    by `createGraphQLContext` from the verified access token).
 *
 * `@pothos/plugin-dataloader` is also installed (kept for the documented
 * batching pattern — see `docs/graphql/dataloader-batching.md`), but it is
 * intentionally NOT loaded in this builder.
 *
 * The `Context` slot is bound to the runtime context produced by
 * `createGraphQLContext` (imported type-only to avoid a runtime cycle).
 *
 * Per `backend/graphql/AGENTS.md`:
 *  - `queryType({})` + `mutationType({})` declared here; fields added via
 *    side-effect imports in `backend/graphql/mutation/` and
 *    `backend/graphql/query/`.
 *
 * Scope semantics:
 *  - `authenticated: true` — caller has a verified `ctx.user` (401 otherwise).
 *  - `role: [UserRole.Admin, ...]` — OR semantics over the role set (403
 *    otherwise). The role comes exclusively from `ctx.role` (sourced from
 *    the verified access token's `payload.role` JWT claim — the fresh DB
 *    row's role is never consulted by this scope; demotion is mitigated at
 *    the service-layer gate).
 *  - `permission: ["PERM.X"]` — fail-closed OR-membership gate: the caller
 *    must hold at least ONE of the declared permission codes in
 *    `ctx.permissions`. An empty declaration list denies unconditionally,
 *    and `ctx.permissions` is currently always `[]` (no permission source
 *    populates the GraphQL context yet), so any field declaring this scope
 *    denies until granted codes are fed into the context.
 *  - `superAdmin: true` — true iff `ctx.isSuperAdmin` (admin role).
 *  - `notImpersonating: true` — placeholder (no impersonation surface yet).
 *
 * AND-composition: declaring multiple scopes on a field requires ALL to
 * pass (Pothos authScope conjunction semantics). E.g. `{ role: [admin],
 * permission: ["users.update"] }` requires both admin role AND the
 * `users.update` permission.
 */
import SchemaBuilder from "@pothos/core";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import WithInputPlugin from "@pothos/plugin-with-input";
import type { UserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { enablePothosDevHmr } from "@/backend/graphql/pothos-hmr";
import { ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { getServerTranslations } from "@/shared/locale/server-graphql";

// Allow Pothos plugins to re-register during Turbopack/Webpack HMR.
if (process.env.NODE_ENV !== "production") {
  SchemaBuilder.allowPluginReRegistration = true;
}

/**
 * The canonical Pothos SchemaBuilder for the project. All Pothos object/enum/
 * input/mutation definitions reference this instance.
 *
 * `Defaults: "v3"` (type parameter) + `defaults: "v3"` (runtime option) —
 * opts into the v3 default-nullability contract: fields are NON-nullable by
 * default (per `backend/graphql/AGENTS.md`: "fields are non-nullable by
 * default unless explicitly set to `nullable: true`"). Individual fields opt
 * INTO nullability via `t.exposeString("field", { nullable: true })` —
 * used for genuinely optional columns like `users.gender`.
 *
 * The `Scopes` type parameter enumerates every scope key usable in
 * `authScopes: { ... }` field options — keeps scope usage type-safe across
 * the schema (a typo like `{ authenticate: true }` is a compile error).
 */
export const gqlSchemaBuilder = new SchemaBuilder<{
  Context: Context;
  Defaults: "v3";
  Scalars: {
    /** Custom scalars registered in `shared/scalar.pothos.ts` (via
     *  `addScalarType`). `DateTime` is backed by `DateTimeResolver` from
     *  `graphql-scalars` (ISO-8601 UTC serialization; Date out, accepts
     *  pre-serialized ISO strings pass-through). `CountryCode` is backed by
     *  `CountryCodeResolver` from `graphql-scalars` (ISO 3166-1 alpha-2;
     *  strings in, value returned unchanged — no normalization).
     *  `PhoneNumber` is backed by `PhoneNumberScalar` from
     *  `backend/graphql/scalars/phoneNumberScalar.ts` (semantic E.164
     *  validation via google-libphonenumber; String in → canonical E.164
     *  String out, `PHONE_INVALID` machine-code error otherwise; lenient
     *  String pass-through serialization). */
    DateTime: { Input: Date; Output: Date | string };
    CountryCode: { Input: string; Output: string };
    PhoneNumber: { Input: string; Output: string };
  };
  AuthScopes: {
    /** Caller must have a verified `ctx.user` (401 otherwise). */
    authenticated: boolean;
    /** Caller's `ctx.role` must be one of the supplied roles (OR semantics). */
    role: UserRole[];
    /** Caller must hold one of the supplied permission codes (OR semantics). */
    permission: string[];
    /** Caller must be a super admin (`ctx.isSuperAdmin`). */
    superAdmin: boolean;
    /** Caller must NOT be impersonating another user. */
    notImpersonating: boolean;
  };
}>({
  plugins: [WithInputPlugin, ScopeAuthPlugin],
  defaults: "v3",
  // authScopes failure→code mapping locked at the SOURCE
  // (non-interchangeable; docs/auth/jwt-authentication-service.md
  // §"401-vs-403 decision state chart"):
  //   - `authenticated` misses THROW UnauthorizedError (UNAUTHORIZED/401) —
  //     explicit scope throws pass through VERBATIM below (no re-mapping).
  //   - `role` / `permission` / `superAdmin` misses RETURN false — they are
  //     mapped HERE onto the canonical localized `ForbiddenError` DomainError
  //     (FORBIDDEN/403, extensions.code native) instead of pothos's internal
  //     non-DomainError ForbiddenError (which only carried a `.code`
  //     property). This keeps the boundary finalizer
  //     (`finalizeGraphqlErrors`) classifying them as domain pass-through so
  //     the code survives serialization as FORBIDDEN — never masked into
  //     INTERNAL_SERVER_ERROR, and never interchanged with UNAUTHORIZED.
  scopeAuthOptions: {
    unauthorizedError: (_parent, context, _info, result) => {
      if ("error" in result.failure) {
        const thrown = result.failure.error;
        if (thrown !== null) {
          return thrown;
        }
      }
      return new ForbiddenError(getServerTranslations(context.locale).errorsTranslations.forbidden);
    },
  },
  authScopes: ctx => ({
    // 401 boundary — no verified ctx.user means UNAUTHORIZED.
    // Throws UnauthorizedError (not ForbiddenError) so the client sees
    // `extensions.code = "UNAUTHORIZED"` (401 semantics) for unauthenticated
    // requests, vs `FORBIDDEN` (403) for insufficient role/permission.
    authenticated: () => {
      if (!ctx.user) {
        throw new UnauthorizedError(getServerTranslations(ctx.locale).errorsTranslations.unauthorized);
      }
      return true;
    },
    // OR semantics over the role set — `roles.includes(ctx.role)`.
    role: (roles: UserRole[]) => (ctx.role ? roles.includes(ctx.role) : false),
    // Fail-closed permission gate — OR membership over the codes granted to
    // the caller (`ctx.permissions`). An empty declaration denies (an empty
    // code set never satisfies `some`), and `ctx.permissions` is currently
    // always `[]` (no permission source populates the context yet), so
    // every field declaring this scope denies. A miss returns false and is
    // mapped onto the canonical localized ForbiddenError (FORBIDDEN/403)
    // by the `unauthorizedError` mapping above — never a silent allow.
    permission: (codes: string[]) => codes.some(p => ctx.permissions.includes(p)),
    // Super-admin gate — `ctx.isSuperAdmin` is set iff role === UserRole.Admin.
    superAdmin: () => ctx.isSuperAdmin,
    // No impersonation surface yet — always true.
    notImpersonating: true,
  }),
});

// Declare root types. Query is declared EMPTY here and receives every root
// field via side-effect imports of `backend/graphql/query/` (wired once in
// `gqlSchema.ts`, before `toSchema()` runs) — the GraphQL spec requirement
// "Type Query must define one or more fields" is satisfied because the
// assembler registers all domain query fields before the schema is
// finalized. Mutation fields are added the same way via
// `import "@/backend/graphql/mutation";` in `gqlSchema.ts`. The probe root
// field is a HealthCheck! object query owned by
// `backend/graphql/query/health.query.ts` together with its Pothos object
// ref in `pothos/shared/`.
gqlSchemaBuilder.queryType({});
gqlSchemaBuilder.mutationType({});

// Always create a fresh builder when this module evaluates. Do NOT cache on
// globalThis — that keeps a stale ConfigStore across HMR and causes either
// Duplicate typename errors or broken onConfig patches.
enablePothosDevHmr(gqlSchemaBuilder);

// HMR dependency edge (hayes/pothos#49): when any schema definition module
// changes, invalidate this builder module too so type registration runs against
// a fresh SchemaBuilder instead of throwing Duplicate typename.
if (process.env.NODE_ENV !== "production") {
  import("@/backend/graphql/gqlSchema.definitions").catch(error => {
    logger.error("Failed to load GraphQL schema definitions for HMR edge", error);
  });
}
