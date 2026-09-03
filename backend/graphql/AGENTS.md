# Backend GraphQL & Pothos Layer Rules

- **Framework**: We use Pothos to build our GraphQL schema code-first.
- **Pothos HMR in dev (hayes/pothos#49)**: Turbopack HMR can re-evaluate a Pothos definition module while the SchemaBuilder survives, throwing "Duplicate typename" / "Duplicate field". The defense is four-fold:
  1. `SchemaBuilder.allowPluginReRegistration = true` in dev (`pothos/builder.ts`).
  2. `enablePothosDevHmr(builder)` from `backend/graphql/pothos-hmr.ts` retires superseded ConfigStore registrations before adding the new one (never wrap `ref.onConfig` — it re-enters `updateConfig` and overflows the stack).
  3. `pothos/builder.ts` dynamically imports `gqlSchema.definitions.ts` in dev, creating an HMR dependency edge so every definition change re-evaluates the builder module against a fresh SchemaBuilder. Do NOT cache the builder on `globalThis` — that pins a stale ConfigStore across HMR.
  4. `app/api/graphql/route.ts` `getHandler()` swaps Apollo onto the new `graphQLSchema` when the module export changes.
  All four layers are dev-only (`NODE_ENV !== "production"`).
- **Auth scopes + RBAC: see `docs/auth/jwt-authentication-service.md` for the canonical `authScopes` contract (`authenticated` / `role` / `permission` / `superAdmin` / `notImpersonating`), 401-vs-403 decision state chart, fail-closed rule, `me` `authenticated` boundary, and DEV2-002 RBAC consumption guide.**
- **Plan catalog operations: see `docs/billing/plan-catalog.md` for role-scoped queries/mutations and Apollo cache `id` normalization requirements.**
- **Nullability**: In Pothos, fields are non-nullable by default unless explicitly set to `nullable: true`. Ensure your TypeScript types align with your Pothos definitions.
- **Resolvers**: Pothos field resolvers should generally delegate to the `backend/services/` layer, rather than putting business logic inside the GraphQL definitions or calling Repositories directly.
- **Cache Updates**: Ensure `id` fields are always exposed on GraphQL objects so the Apollo client can auto-update its cache.
- **Locale Propagation & Localized Errors**: GraphQL field resolvers must propagate the request locale (`ctx.locale`) to service and repository calls to enable proper localized error messages. Any direct error thrown in resolvers must be translated via `ctx.t("<namespace>")` — already bound to `ctx.locale`. Example: `const tErrors = await ctx.t("errors"); throw new GraphQLError(tErrors.auth.invalidCredentials, ...);`. Do NOT import `getBackendTranslations` or `next-intl`.
- **Type Definition Pattern**: GraphQL Pothos objects should use types from `backend/types/` (e.g., `{Entity}ReturnType`, `{Entity}SubmitInput`) as the underlying type references for object and input definitions. Import these types from `@/backend/types` and use them in Pothos `.implement()` calls to ensure consistency between GraphQL types and backend service/repository types.
- **Gateway route & registration contract**: see `docs/graphql/api-gateway-and-routing.md` for the canonical seven-step pipeline in `app/api/graphql/route.ts`, the default-deny public-operation allowlist (`backend/lib/gateway/public-operations.ts` — every new anonymous operation needs a security-rationale entry BEFORE its resolver ships scopeless), and the REQ-018 rules for registering resolvers/objects/enums. `ctx.idempotencyKey` is captured exactly once in `createGraphQLContext` from the raw `X-Idempotency-Key` header (`null` when absent) and is PROPAGATION-ONLY: mutations consume it for duplicate-blocking semantics, but it must never influence authorization or be re-derived/trimmed elsewhere.
- **Participant-scoped operations (session lifecycle precedent)**: when an operation's access rule is "authenticated, then the service checks participation/ownership" (e.g. `sessionById`, `cancelSession`), declare ONLY `{ authenticated: true }` and keep the participant predicate service-side — never widen it for admins or other roles. When a role leg exists, make the conjunction EXPLICIT with `$all { authenticated: true, role: [UserRole.X] }` — a plain key-map combines its keys with ANY semantics (wrong). Sessions are disclosure-sensitive: a foreign id and a nonexistent id are indistinguishable on every read and mutation (identical `null` channel / byte-identical denial). See `docs/sessions/session-lifecycle.md` §2/§7.

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

### Positive Pattern (Required):
- Create a single GraphQL object type per entity using types from `backend/types/` (e.g., `{Entity}ReturnType`)
- Use the canonical type as the basis for Pothos object implementation: `gqlSchemaBuilder.objectRef<{Entity}ReturnType>("<Entity>")`
- Add additional fields as needed (resolved relationships, computed properties) beyond the canonical type
- Leverage GraphQL's selection mechanism - clients can request only the fields they need from the full object
- Define input types using types from `backend/types/` (e.g., `{Entity}SubmitInput`)

### Negative Pattern (PROHIBITED - Major Violation):
- Creating local type definitions within Pothos files (e.g., `export type {Entity}Definition = {...}`)
- Defining multiple GraphQL object types for the same entity when one canonical type would suffice
- Duplicating entity structure in local types instead of using centralized types from `backend/types/`
- Creating ad-hoc types like `export type <Entity>SimpleDefinition`

### Example of Proper Pattern:
```typescript
// Instead of defining local types in Pothos files:
export type <Entity>SimpleDefinition = {
  id: string;
  name: string;
};

// Use types from backend/types:
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

### Exception Policy:
- Input types (mutation inputs, filter inputs) are allowed as separate definitions when they serve a specific purpose
- Wrapper types for collections or complex responses (e.g., paginated results) are allowed as separate definitions
- Complex computed/derived types that don't map directly to a single table may require custom definitions (but should still import base types from `backend/types/`)

## WhatsApp GraphQL Patterns

- **Canonical reference**: `docs/services/whatsapp-cloud-api.md` — comprehensive WhatsApp integration patterns. *(doc file absent from this tree — pending the WhatsApp-integration ticket; see `ai/plans/dev3-002-shared-error-handling-response-contracts/deferred-items.md` BLT-03)*
- **Object types**: `WhatsappAccountPothosObject`, `WhatsappTemplateSnapshotPothosObject` (BL3), `WhatsappSyncFromMetaResultPothosObject` (wrapper). All expose `id` for Apollo cache normalization.
- **Input type pattern**: Use `inputType(string-named)` instead of `inputRef<BackendType>` to avoid LocalizedString null incompatibility.
- **Credential mutations**: `setWhatsappAccessToken`, `setWhatsappTwoStepPin` — all credential/config mutations call `resetWhatsappChannel()` (S4) for token rotation without restart.
- **Delete behavior**: `deleteWhatsappAccount` deactivates (`isActive = false`), does not hard-delete.
- **Side-effect barrels**: `import "./whatsapp-account.mutation";` registers resolvers via side-effect imports.

## Pothos Field Factories (Duplication Elimination)

When multiple Pothos object types, input types, or query fields share identical field definitions, extract into `shared/` helper modules. See `docs/graphql/pothos-field-factories.md` for the complete pattern reference.

Completed extractions:
- `paymentFields` — `backend/graphql/pothos/billing/shared/paymentFieldHelpers.ts`
- `creditTransactionFields` — `backend/graphql/pothos/billing/shared/creditFieldHelpers.ts`
- `classSubjectInputFields` — `backend/graphql/pothos/classes/shared/classSubjectFieldHelpers.ts`
- `teacherNoteInputFields` — `backend/graphql/pothos/teachers/shared/teacherNoteFieldHelpers.ts`
- `whatsappAccountSharedInputFields` — `backend/graphql/pothos/whatsapp/shared/whatsappAccountFieldHelpers.ts`
- `supportedListArgs` / `supportedListResolve` — `backend/graphql/query/billing/shared/makeSupportedPaymentListQueryField.ts`
- `makeTeacherMonthlyReportQueryField` / `makeStudentMonthlyReportQueryField` — `backend/graphql/query/reports/shared/makeMonthlyReportQueryField.ts`
- `resolveStudentIdFromArgsOrUser` — `backend/graphql/query/students/shared/resolveStudentIdFromArgsOrUser.ts`

## General User Create Mutation Pattern

The `createGeneralUser` mutation creates a user without a specialized profile extension. It uses `authScopes: { permission: AppPermission.STAFF_CREATE, notImpersonating: true }` to require staff create permission and block creation while impersonating. The `groupSlug` input field is a plain `String!` (not an enum) to allow any permission group slug — specialized groups are rejected at the service layer via `isSpecializedGroup()`. The result type includes `id` (resolved from `parent.user.id`) for Apollo cache normalization. See `docs/services/general-user-creation.md` for the complete pattern reference.

## authScope Pattern: `permission` vs `superAdmin`

Use `authScopes: { permission: AppPermission.X }` (not `authScopes: { superAdmin: true }`) for mutations accessible by non-superadmin users with the correct permission. The `superAdmin: true` authScope blocks ALL non-superadmin users — only use it for truly superadmin-only operations (e.g., impersonation, permission group simulation, system config).

See `docs/auth/supervisor-permissions.md` for the supervisor permission model and the list of mutations that were fixed from `superAdmin: true` to permission-based authScopes.

## Serverless Cold-Start Optimization

- **Permission Context Propagation**: Resolvers calling services with permission checks MUST pass `UserPermissionContext` from `ctx` instead of passing only `ctx.user.id`. This eliminates redundant `PermissionsService.getUserContext(userId)` DB queries. The context object `{ permissions: ctx.permissions, permissionGroups: ctx.permissionGroups, isSuperAdmin: ctx.isSuperAdmin, role: ctx.role }` is already populated by `createContext`. See `docs/backend/serverless-cold-start-optimization.md`.
- **Lazy scopeAuth**: `superAdmin` scope is a lazy scope-loader function, not an eager boolean — only evaluates when a field with `authScopes: { superAdmin: true }` is actually queried. The `permission` scope uses `ctx.isSuperAdmin` and `ctx.permissions` directly (no `getUserContext` call).
- **`safeUser` on `BaseContext`**: `ctx.safeUser` contains the full sanitized user object (password/rememberTokenHash stripped). Resolvers needing user data (e.g., `Query.me`) should use `ctx.safeUser` instead of calling `UserService.findById`.
- **Context anchor**: All per-request context wiring happens inside `createGraphQLContext` (`gqlContextFactory.ts`) — including the SINGLE requestId resolution point, which composes `resolveRequestId(request.headers)` exactly once and exposes it as `ctx.requestId` (correlation-only; never re-resolved downstream). There is no `preloadSession` helper; treat that legacy name as retired.
- **Login resolver cold-start resilience**: Rate limiter operations in the login resolver (`checkRateLimit`, `isLocked`, `recordAttempt`, `resetAttempts`) MUST use fail-open `try/catch` — transient cold-start errors must NOT block login. Critical DB reads (`findByEmail`, `createAuthSession`) MUST use `retryTransient()` from `@/backend/lib`. On exhaustion, return `SERVICE_UNAVAILABLE` (NOT `INVALID_CREDENTIALS`). See `docs/graphql/error-handling-contract.md` for the `SERVICE_UNAVAILABLE` transport semantics.

## DomainError → GraphQLError extensions.code

- DomainError subclasses extend GraphQLError to propagate `extensions.code` to clients. All resolver errors MUST use DomainError subclasses (NotFoundError, UnauthorizedError, ForbiddenError, ValidationError, ConflictError). See `docs/graphql/domain-error-extensions-code.md` for throw conventions and `docs/graphql/error-handling-contract.md` for the transport contract (REQ-010 taxonomy, envelopes, client mapping).
- **Masking belongs to the boundary only** — resolvers/services NEVER format, mask, or log-classify errors themselves; `finalizeGraphqlErrors` runs solely via its plugin.
- **Exactly one finalizer registration**: `createGraphqlErrorsFinalizerPlugin()` is registered once, in the single module-scope ApolloServer plugins array of `app/api/graphql/route.ts`. A second registration double-masks classified items and fails the pinned suites.

## Recitation Catalog (Qira'ah)

Recitation enum registered in `shared/enum.pothos.ts` as `RecitationReadingPothosEnum` (enum-object form, from the canonical shared `RecitationReading` enum in `@/shared/constants/recitation-reading.enum`); public `recitationReadings: [RecitationReading!]!` query in `query/recitation.query.ts` (no authScope, delegates to `RecitationCatalogService.listReadings()`, pure — no DB). The registration input `preferredRecitation` is validated by `RecitationCatalogService.validateOptionalReading` and echoed as contract metadata only — NOT persisted to `recitation` (C.5 invariant). See `docs/auth/qiraah-selection-and-c5.md`.

## Linting Rules

- See `docs/quality/linting-rules.md` for Oxlint & ESLint/sonarjs fix recipes. NEVER use `oxlint-disable` comments.

