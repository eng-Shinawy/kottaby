# Backend GraphQL & Pothos Layer Rules

- **Framework**: We use Pothos to build our GraphQL schema code-first.
- **Pothos HMR in dev (hayes/pothos#49)**: Turbopack HMR can re-evaluate a Pothos definition module while the SchemaBuilder survives, throwing "Duplicate typename" / "Duplicate field". The defense is four-fold:
  1. `SchemaBuilder.allowPluginReRegistration = true` in dev (`pothos/builder.ts`).
  2. `enablePothosDevHmr(builder)` from `backend/graphql/pothos-hmr.ts` retires superseded ConfigStore registrations before adding the new one (never wrap `ref.onConfig` — it re-enters `updateConfig` and overflows the stack).
  3. `pothos/builder.ts` dynamically imports `gqlSchema.definitions.ts` in dev, creating an HMR dependency edge so every definition change re-evaluates the builder module against a fresh SchemaBuilder. Do NOT cache the builder on `globalThis` — that pins a stale ConfigStore across HMR.
  4. `app/api/graphql/route.ts` `getHandler()` swaps Apollo onto the new `graphQLSchema` when the module export changes.
  All four layers are dev-only (`NODE_ENV !== "production"`).
- **Auth scopes**: `authScopes` supports the kinds `authenticated` / `role` / `permission` / `superAdmin` / `notImpersonating`. Scope checks are fail-closed: an unrecognized or unsatisfied scope denies access rather than falling through. Returning `401` vs `403` matters — unauthenticated requests must not be indistinguishable from denied authenticated ones.
- **Nullability**: In Pothos, fields are non-nullable by default unless explicitly set to `nullable: true`. Ensure your TypeScript types align with your Pothos definitions.
- **Resolvers**: Pothos field resolvers should generally delegate to the `backend/services/` layer, rather than putting business logic inside the GraphQL definitions or calling Repositories directly.
- **Cache Updates**: Ensure `id` fields are always exposed on GraphQL objects so the Apollo client can auto-update its cache.
- **Locale Propagation & Localized Errors**: GraphQL field resolvers must propagate the request locale (`ctx.locale`) to service and repository calls to enable proper localized error messages. Any direct error thrown in resolvers must be translated via `ctx.t("<namespace>")` — already bound to `ctx.locale`. Example: `const tErrors = await ctx.t("errors"); throw new GraphQLError(tErrors.auth.invalidCredentials, ...);`. Do NOT import `getBackendTranslations` or `next-intl`.
- **Type Definition Pattern**: GraphQL Pothos objects should use types from `backend/types/` (e.g., `{Entity}ReturnType`, `{Entity}SubmitInput`) as the underlying type references for object and input definitions. Import these types from `@/backend/types` and use them in Pothos `.implement()` calls to ensure consistency between GraphQL types and backend service/repository types.
- **Gateway public-operation allowlist**: the anonymous-access allowlist (`backend/lib/gateway/public-operations.ts`) is default-deny — every new anonymous operation needs a security-rationale entry in it BEFORE its resolver ships scopeless. `ctx.idempotencyKey` is captured exactly once in `createGraphQLContext` from the raw `X-Idempotency-Key` header (`null` when absent) and is PROPAGATION-ONLY: mutations consume it for duplicate-blocking semantics, but it must never influence authorization or be re-derived/trimmed elsewhere.
- **Scope composition**: when an operation's access rule is "authenticated, then the service checks participation/ownership", declare ONLY `{ authenticated: true }` and keep the predicate service-side — never widen it for admins or other roles. When a role leg exists, make the conjunction EXPLICIT with `$all { authenticated: true, role: [UserRole.X] }` — a plain key-map combines its keys with ANY semantics (wrong). For disclosure-sensitive objects, a foreign id and a nonexistent id should be indistinguishable on every read and mutation (identical `null` channel / byte-identical denial).
- **Resolver side-effect imports**: domain definition modules register their Pothos types/resolvers via side-effect imports (e.g. `import "./<domain>.mutation";`) from the definitions entrypoint.

## Pothos Enum Registration Pattern (CRITICAL RULE)

GraphQL enums MUST be backed by a real TypeScript `enum` defined in `backend/enum/`. **Hardcoding enum value literal arrays inside a Pothos file is PROHIBITED** — it bypasses the single-source-of-truth enum definition and drifts away from the backend layer.

### Positive Pattern (Required):
- Define the enum in `backend/enum/<subdir>/<entity>.enum.ts` (see `backend/enum/AGENTS.md`).
- Register it with Pothos by passing the enum object: `gqlSchemaBuilder.enumType(MyEnum, { name: "MyEnum" })`.
- All Pothos enum registrations live in `backend/graphql/pothos/shared/enum.pothos.ts`. Import the registered Pothos enum (e.g. `MyEnumPothosEnum`) from there into the domain Pothos files that reference it on a field — never re-register the same enum in a domain file.
- Run `bun run generate:gqlSchema` then `bun codegen` after registering a new enum so the frontend codegen output (`@/frontend/graphql/generated/gql/graphql`) stays in sync.

```typescript
// backend/enum/profiles/profile.enum.ts
export enum ProfileMode {
  VIEW = "view",
  EDIT = "edit",
}

// backend/graphql/pothos/shared/enum.pothos.ts
import { ProfileMode } from "@/backend/enum";
export const ProfileModePothosEnum = gqlSchemaBuilder.enumType(ProfileMode, { name: "ProfileMode" });

// backend/graphql/pothos/profile/profile.pothos.ts
import { ProfileModePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
// ...use ProfileModePothosEnum as a field type
```

### Negative Pattern (PROHIBITED):
- Hardcoding enum value literals inside a Pothos file:
  ```typescript
  // ❌ DO NOT DO THIS in *.pothos.ts files
  export const ProfileModePothosEnum = gqlSchemaBuilder.enumType("ProfileMode", {
    values: ["view", "edit"] as const,
  });
  ```
- Defining a TypeScript `enum` inline inside a Pothos file instead of `backend/enum/`.
- Re-registering an enum that is already registered in `shared/enum.pothos.ts` (produces a "has already been declared" runtime error).
- Re-declaring enum values as a string-union type somewhere else (e.g. `type ProfileMode = "view" | "edit"`); the canonical enum lives in `backend/enum/` and all other layers should reference that enum (or, for the frontend, the GraphQL codegen enum).

### Migrating an existing hardcoded Pothos enum:
1. Define (or locate) the canonical TypeScript `enum` under `backend/enum/<subdir>/`.
2. Add it to the sub-directory's `index.ts` and (if needed) the top-level `backend/enum/index.ts` barrel.
3. Register it once in `backend/graphql/pothos/shared/enum.pothos.ts` using the enum-object form.
4. Replace any `values: [...]` usages in domain Pothos files with an import of the registered Pothos enum from `shared/enum.pothos`.
5. Regenerate the schema and codegen.

## Single Canonical Object Type Pattern (CRITICAL RULE)

The `backend/AGENTS.md` canonical-object-type rule applies here with Pothos specifics:
- Create a single GraphQL object type per entity: `gqlSchemaBuilder.objectRef<{Entity}ReturnType>("<Entity>")`, with additional resolved/computed fields added to that one type as needed.
- Input types (mutation inputs, filter inputs) are allowed as separate definitions when they serve a specific purpose, as are wrapper types for collections or complex responses (e.g., paginated results) and computed/derived types that don't map to a single table (still importing base types from `backend/types/`).
- Prefer `inputType(string-named)` over `inputRef<BackendType>` for inputs — `inputRef` couples the input's nullability to the backend type's exact shape, and drift between the two surfaces as null-incompatibility errors.

```typescript
import type { {Entity}ReturnType } from "@/backend/types";

const {Entity}Ref = gqlSchemaBuilder.objectRef<{Entity}ReturnType>("<Entity>");
export const {Entity}PothosObject = {Entity}Ref.implement({
  fields: t => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    // ... other fields from {Entity}ReturnType
  }),
});
```

## Pothos Field Factories (Duplication Elimination)

When multiple Pothos object types, input types, or query fields share identical field definitions, extract them into `shared/` helper modules within the domain directory and import them from each consumer.

## Admin-Mutation Audit Census (CRITICAL RULE)

- **Census-before-admin-mutation:** every new admin-gated mutation shipped under `backend/graphql/mutation/**` MUST add a matching `wired` row to `test/workflows/admin/audit-completeness.catalog.ts` (expected action types + entity type) and emit its audit row at the service layer. `backend/db/test/logic/audit/audit-census-drift.test.ts` enforces the bijection — an unaudited admin mutation fails CI.

## authScope Pattern: `permission` vs `superAdmin`

Use `authScopes: { permission: AppPermission.X }` (not `authScopes: { superAdmin: true }`) for mutations accessible by non-superadmin users with the correct permission. The `superAdmin: true` authScope blocks ALL non-superadmin users — only use it for truly superadmin-only operations.

## Serverless Cold-Start Optimization

- **Permission Context Propagation**: Resolvers calling services with permission checks MUST pass `UserPermissionContext` from `ctx` instead of passing only `ctx.user.id`. This eliminates redundant `PermissionsService.getUserContext(userId)` DB queries. The context object `{ permissions: ctx.permissions, permissionGroups: ctx.permissionGroups, isSuperAdmin: ctx.isSuperAdmin, role: ctx.role }` is already populated by `createContext`.
- **Lazy scopeAuth**: `superAdmin` scope is a lazy scope-loader function, not an eager boolean — only evaluates when a field with `authScopes: { superAdmin: true }` is actually queried. The `permission` scope uses `ctx.isSuperAdmin` and `ctx.permissions` directly (no `getUserContext` call).
- **`safeUser` on `BaseContext`**: `ctx.safeUser` contains the full sanitized user object (password/rememberTokenHash stripped). Resolvers needing user data (e.g., `Query.me`) should use `ctx.safeUser` instead of calling `UserService.findById`.
- **Context anchor**: All per-request context wiring happens inside `createGraphQLContext` (`gqlContextFactory.ts`) — including the SINGLE requestId resolution point, which composes `resolveRequestId(request.headers)` exactly once and exposes it as `ctx.requestId` (correlation-only; never re-resolved downstream). There is no `preloadSession` helper; treat that legacy name as retired.

## DomainError → GraphQLError extensions.code

- DomainError subclasses extend GraphQLError to propagate `extensions.code` to clients. All resolver errors MUST use DomainError subclasses (NotFoundError, UnauthorizedError, ForbiddenError, ValidationError, ConflictError).
- **Masking belongs to the boundary only** — resolvers/services NEVER format, mask, or log-classify errors themselves; `finalizeGraphqlErrors` runs solely via its plugin.
- **Exactly one finalizer registration**: `createGraphqlErrorsFinalizerPlugin()` is registered once, in the single module-scope ApolloServer plugins array of `app/api/graphql/route.ts`. A second registration double-masks classified items and fails the pinned suites.
