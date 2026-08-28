# Shared Layer Rules

## Purpose

The `shared/` layer contains code used by **both** frontend and backend: utilities, i18n messages, domain constants, enums, and cross-layer types. It sits below `app/`, `frontend/`, and `backend/` in the dependency graph — nothing in shared may depend on those layers.

## Layer Isolation (CRITICAL)

- **NEVER** import from `@/frontend/**`, `@/backend/**`, or `@/app/**`.
- Enforced by ESLint `no-restricted-imports` in `eslint.config.mjs` for all `shared/**/*.{ts,tsx}` files.
- If shared code needs a value that currently lives in another layer (enum, type, utility), **move or duplicate the canonical definition into `shared/`** and have the other layer import from shared — not the reverse.

### Positive Pattern

```typescript
// shared/lib/social-links.ts
import { isSafeUrl } from "@/shared/lib/safe-url";

// shared/lib/schedule-instance-dashboard-status.ts
import { ClassExecutionState, ClassOutcome } from "@/shared/constants/class-instance-detail.enum";
```

### Negative Pattern (PROHIBITED)

```typescript
import { isSafeUrl } from "@/frontend/lib/safeRedirect";
import { ClassOutcome } from "@/backend/enum";
import type { InvoiceStatus } from "@/frontend/graphql/generated/gql/graphql";
```

## Import Convention

- Always use the `@/` path alias — relative `./` or `../` imports are banned (same rule as `app/`, `backend/`, `frontend/`, `test/`, and `scripts/`).
- Prefer deep imports over barrel files: `import { ClassOutcome } from "@/shared/constants/class-instance-detail.enum"`.
- `**/index.ts` barrel files may use relative `./` sibling re-exports by design (ESLint exception).

## File Organization

| Directory | Purpose | Examples |
|-----------|---------|----------|
| `shared/lib/` | Pure utilities and domain logic with no layer deps | `safe-url.ts`, `social-links.ts`, `phone/`, `logger/` |
| `shared/constants/` | Enums and stable domain constants | `class-instance-detail.enum.ts`, `billing-months.ts`, `permission-group.enum.ts` |
| `shared/types/` | Cross-layer TypeScript types | `billing-view.ts` |
| `shared/messages/` | i18n message definitions and label types | `en.ts`, `ar/`, `types/` |
| `shared/utils/` | General helpers | `date-utils.ts`, `storage.utils.ts` |

## Shared Enums

When frontend and backend both need the same enum values:

1. Define the enum in `shared/constants/{domain}.enum.ts` using the same string values as the backend enum.
2. Use dot access in shared code and tests: `ClassOutcome.PENDING`, `SystemPermissionGroupSlug.SUPER_ADMIN`.
3. Keep `@/backend/enum` for backend-only code; backend services/repos import from there.
4. Frontend should use GraphQL codegen enums for API-facing types, or import from `@/shared/constants/` when shared logic requires the same values.
5. **Never** import `@/backend/enum` from `shared/` — see `backend/enum/AGENTS.md`.

## Specialized Group Constants

`shared/constants/specialized-groups.constants.ts` exports `SPECIALIZED_GROUP_SLUGS` (readonly tuple of student/teacher/parent default group slugs), `SPECIALIZED_GROUP_SLUG_SET` (Set<string> for O(1) lookup), and `isSpecializedGroup(slug)` predicate. Used by backend services to reject specialized groups in general user creation and by frontend to filter the permission group dropdown. See `docs/services/general-user-creation.md` for usage.

## Free Trial Sizing Constant

`shared/constants/free-trial.constants.ts` holds `FREE_TRIAL_SESSION_COUNT` — the single source of truth for trial sizing (one free trial session per newly registered student). The constant lives in the shared layer (zero imports from `@/backend/**`, `@/frontend/**`, or `@/app/**`) so any future consumer — the DEV3 booking flow, a future admin dashboard, a future frontend trial-balance badge — can import it without violating layer isolation. See `docs/students/free-trial-provisioning.md` for the full trial-provisioning contract.

## Recitation Catalog (Qira'ah)

Recitation catalog: `shared/constants/recitation-reading.enum.ts` is the canonical `RecitationReading` enum (10 Qira'at — stable lowercase snake_case values), with the frozen `RECITATION_READINGS` array and the `isRecitationReading(value: unknown)` type guard. The physical `recitation` table is session-linked per decision C.5 (1:1 with `session` via unique `session_id`) — this catalog is for user-preference selection only and MUST NOT be used to create user-linked `recitation` rows. See `docs/auth/qiraah-selection-and-c5.md`.

## Extracting Code Into Shared

When moving logic from `frontend/` or `backend/` into `shared/`:

1. Place the implementation in the appropriate `shared/` subdirectory (`lib/`, `constants/`, `types/`).
2. Update all consumers to import directly from the `shared/` source (e.g. `import { isSafeUrl } from "@/shared/lib/safe-url"`). Do not re-export from `frontend/` or `backend/` locations — consumers must import from `shared/` directly.
3. Move or define any required enums/types in `shared/` before updating imports in shared files.
4. Run tests for affected shared modules and verify ESLint passes on changed `shared/**` files.

## i18n Message Types

- Message label types in `shared/messages/types/` must not reference frontend view types or GraphQL codegen types.
- Define canonical status/key unions in `shared/types/` or `shared/constants/` and use those in message type definitions.
- Example: `BillingMonthId` lives in `@/shared/constants/billing-months`; `AdminInvoiceStatus` in `@/shared/types/billing-view`.

## Translation System (Compile-Time i18n)

### Overview
Kottaby replaces the legacy `next-intl` package (now fully removed) with a custom **compile-time TypeScript i18n system** in `shared/locale/` that provides:
- **Compile-time safety**: `t.x.y` instead of `t("x.y")` — IDE autocomplete + TypeScript errors on missing keys
- **Native TypeScript pluralization**: `(count: number) => string` functions instead of ICU strings
- **Lazy loading**: standard dynamic `import()` per namespace — only loads needed translations
- **SSR & API support**: `getTranslations(locale, namespace)` for server components / API routes
- **GraphQL context integration**: `ctx.t("namespace")` bound to `ctx.locale`
- **SEO routing preserved**: Next.js native `[locale]` segments + middleware (Native Next.js routing, no third-party i18n routing library.)

### File Structure
```
shared/locale/
├── AppLocale.ts              ← locale enum & type
├── serverLegacy.ts                 ← getTranslations<K>(locale, namespace) for SSR/API
├── server-graphql-legacy.ts         ← getServerTranslations<K>(locale, namespace) for GraphQL/scripts
├── clientLegacy.ts                 ← useAppTranslation<K>(namespace) hook for client components
├── index.ts                  ← re-exports
│
├── types/                    ← TypeScript interfaces (the "schema")
│   ├── auth/index.ts
│   ├── common/index.ts
│   ├── dashboard/<domain>/...
│   ├── errors/index.ts
│   ├── ui/index.ts
│   ├── profile.ts
│   ├── session/index.ts
│   └── message.ts            ← MessageSchema (top-level map of all namespaces)
│
├── ar/                       ← Arabic implementations
│   ├── auth/index.ts
│   ├── common/index.ts
│   ├── dashboard/<domain>/...
│   ├── errors.ts
│   ├── ui/index.ts
│   └── profile.ts
│
└── en/                       ← English implementations
    ├── auth/index.ts
    ├── common/index.ts
    ├── dashboard/<domain>/...
    ├── errors.ts
    ├── ui/index.ts
    └── profile.ts
```

### Rules for All Layers

#### Server Components (`app/**/*.tsx`)
```typescript
// ✅ Correct
import { getTranslations } from "@/shared/locale/server";
const t = await getTranslations(locale, "auth");
return <h1>{t.login.pageTitle}</h1>;

// ❌ Forbidden
import { getTranslations } from "next-intl/server";
const t = await getTranslations({ locale, namespace: "auth.login" });
return <h1>{t("pageTitle")}</h1>;
```

#### Client Components (`frontend/**/*.tsx`)
```typescript
// ✅ Correct
import { useAppTranslation } from "@/shared/locale/client";
const t = useAppTranslation("auth").login;
return <input placeholder={t.email} />;

// ❌ Forbidden
import { useTranslations } from "next-intl";
const t = useTranslations("auth.login");
return <input placeholder={t("email")} />;
```

#### GraphQL Resolvers (`backend/graphql/**/*.mutation.ts`, `*.query.ts`)
```typescript
// ✅ Correct
resolve: async (_parent, args, ctx) => {
  const tErrors = await ctx.t("errors");
  throw new GraphQLError(tErrors.auth.invalidCredentials, ...);
};

// ❌ Forbidden
import { getBackendTranslations } from "@/backend/lib/intl";
const t = await getBackendTranslations({ locale: ctx.locale, namespace: "errors" });
throw new GraphQLError(t("auth.invalidCredentials"), ...);
```

#### API Routes / Scripts / Tests (`app/api/**`, `scripts/**`, `backend/db/test/**`)
```typescript
// ✅ Correct
import { getServerTranslations } from "@/shared/locale/server-graphql";
const t = await getServerTranslations(locale, "errors");
return NextResponse.json({ error: t.auth.notFound }, { status: 404 });
```

### Pluralization Pattern
Replace ICU strings with TypeScript functions in the type schema and implementations:

```typescript
// types/dashboard/students.ts
export interface StudentDirectoryLabels {
  title: string;
  studentCount: (count: number) => string; // Typed function — compile-time safe!
}

// ar/dashboard/students.ts
export const studentDirectory: StudentDirectoryLabels = {
  title: "الطلاب",
  studentCount: (count) => {
    if (count === 0) return "لا يوجد طلاب";
    if (count === 1) return "طالب واحد";
    if (count === 2) return "طالبان";
    if (count >= 3 && count <= 10) return `${count} طلاب`;
    return `${count} طالباً`;
  },
};

// en/dashboard/students.ts
export const studentDirectory: StudentDirectoryLabels = {
  title: "Students",
  studentCount: (count) =>
    count === 0 ? "No students" : count === 1 ? "1 student" : `${count} students`,
};
```

**Usage:** `t.studentDirectory.studentCount(42)` → `"42 طالباً"`

### Interpolation Pattern
Replace `{placeholder}` ICU strings with typed template functions:

```typescript
// types/auth/index.ts
export interface AuthImpersonationLabels {
  bannerLoggedInAs: (name: string) => string;  // was: string with {name}
  bannerViewingAs: (name: string, email: string) => string;
  // static strings stay as string
  returnToNormalLogin: string;
}

// ar/auth/index.ts
export const auth: AuthLabels = {
  impersonation: {
    bannerLoggedInAs: (name) => `أنت مسجل الدخول باسم ${name}.`,
    bannerViewingAs: (name, email) => `أنت تعرض لوحة التحكم باسم ${name} (${email})`,
  }
};
```

**Usage:** `t.impersonation.bannerLoggedInAs("أحمد")`

### Namespace Registration (Required for each new namespace)
1. Add interface to `shared/locale/types/<namespace>/index.ts`
2. Add implementations to `shared/locale/ar/<namespace>/index.ts` and `shared/locale/en/<namespace>/index.ts`
3. Export in `shared/locale/types/message.ts` (add to `MessageSchema`)
4. Add path mapping in `shared/locale/serverLegacy.ts` (`namespacePaths` map)
5. If used in layout SSR, add to `LocaleProvider` translations in `app/[locale]/layout.tsx`

### Public import contract

- **Product code** (`app/`, `frontend/`, `backend/` outside `shared/locale/`) imports **`@/shared/locale`** and **`@/shared/locale/types`** only — never deep paths such as `@/shared/locale/old/**` or `@/shared/locale/beta/**`.
- **`shared/locale/index.ts`** and **`shared/locale/types/index.ts`** are the public barrel — add new canonical exports there when modules land; run `bun tsgo` after barrel changes.
- **Inside `shared/locale/`** implementation files may use relative or deep paths.

### View-layer label types

Canonical `*Labels` interfaces live in `shared/locale/types/**`. View-layer code in `frontend/views/**/types/` may **`Pick`**, **`Omit`**, or compose those canonical types (e.g. `*ShellLabels`, column/filter slices) — do not duplicate string keys. See `frontend/views/AGENTS.md` Rule 7 for placement and grouping thresholds.

### Migration Status
- **Complete**: all translation namespaces now live in `shared/locale/`; the legacy `next-intl` package has been fully removed from `package.json`.
- **Legacy intact**: nothing — `shared/messages/` directory no longer exists; `next-intl` is no longer installed; `NextIntlClientProvider` is not used anywhere. Do not reintroduce them.

### Browser Translation Cache (Hybrid SW + IndexedDB)

- **Primary Path (HTTPS / Secure Contexts)**: Service Worker (`public/sw.js`) intercepts `/_next/static/chunks/*.js` GET requests and caches responses in Cache API store `kottaby-static-chunks-v1`. Per-namespace invalidation happens automatically via Turbopack content hashes in chunk URLs.
- **Fallback Path (HTTP Staging / Insecure Contexts)**: Auto-detected via `window.isSecureContext === false`. Serves JSON snapshots from IndexedDB (`kottaby-locale-snapshots`) keyed by `${BUILD_ID}:${namespaceId}:${locale}`.
- **Build ID Stamping**: Resolved in `next.config.ts` (`NEXT_PUBLIC_BUILD_ID` env → `.next-locale-snapshots-version` content hash → random UUID fallback). Mismatched `BUILD_ID` automatically wipes stale IndexedDB entries on first access.
- **Adding New Namespaces**: Each new `defineNamespace` call in `shared/locale/namespaces/**/*.namespace.ts` MUST pass a stable string ID as the first parameter (e.g. `defineNamespace("dashboard.students.directory", config)`).

### The `errors` namespace — canonical transport-message surface

The `errors` namespace (types/en/ar triple under `shared/locale/{types,en,ar}/errors/`, client handle `Errors`) is **THE** canonical namespace for transport error copy: its 18-key list (`accountBlocked accountDeleted accountSuspended badRequest conflict duplicateRequest failedToSetLocale forbidden forbiddenRole internalServerError invalidLocale invalidOrigin notFound rateLimitExceeded serviceUnavailable tokenExpired unauthorized validation`) is consumed by the backend masking/envelope producers and the frontend code→behavior map. There is NO `validationFailed` and NO `rateLimited` key — canonical names are `validation` and `rateLimitExceeded`. Never add near-duplicate keys for the same semantics in other namespaces (REQ-055); when both layers need a message, the `errors` side owns it (known pre-existing overlaps `rateLimitExceeded`/`accountBlocked` vs `auth` are historical and stay as-is). Full contract mapping: `docs/graphql/error-handling-contract.md`.

## Cross-Layer Shared Types Pattern

When a type definition is used by both backend and frontend, it MUST live in `shared/types/` to avoid duplication. See `docs/backend/shared-types-pattern.md` for the complete pattern.

Key rules:
- Cross-layer types go in `shared/types/<domain>.types.ts`
- Both backend and frontend import from the same canonical file
- `shared/` layer MUST NOT import from `backend/` or `frontend/`

## Locale Namespace Migration

Monolithic locale files (e.g., `profile.ts`, `meeting-config.ts`) should be migrated to camelCase sub-module directories. See `docs/i18n/locale-namespace-migration.md` for the migration pattern.

Completed migrations: `profile/`, `meetingConfig/`, `paymentMethod/`

## Linting Rules

- See `docs/quality/linting-rules.md` for Oxlint & ESLint/sonarjs fix recipes. NEVER use `oxlint-disable` comments.

