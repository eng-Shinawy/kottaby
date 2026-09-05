# AGENTS.md

This document provides essential context for AI agents working in this codebase. It focuses on non-obvious patterns, gotchas, and commands that aren't self-evident from reading individual files.

## Project Overview

Kottaby is a Next.js 16 (App Router) full-stack application using:
- **Runtime**: Bun (not Node.js)
- **Frontend**: React 19, MUI v9, Apollo Client v4, Zustand
- **Backend**: Pothos GraphQL, Drizzle ORM, PostgreSQL
- **Testing**: Bun test runner, Vitest for Storybook, Playwright for E2E
- **i18n**: **Custom compile-time TypeScript system** in `shared/locale/` (replaces legacy `next-intl`; see `shared/AGENTS.md` for rules). Next.js native `[locale]` routing preserved.

## Essential Commands

All commands use Bun. The specific binary path `~/.bun/bin/bun` is required in some environments.

```bash
# Development
bun run dev                    # Start dev server with Turbopack on port 3000
bun run dev:safe               # Safe dev mode via scripts/safe-dev.ts
bun run debug                  # Same as dev (alias for debugging workflows)
bun run dev:inspect            # Start dev server with Node inspector enabled (--inspect)

# Build & Type Check
bun run build                  # Next.js production build
bun run tsgo                   # Fast TypeScript checking (tsgo, not tsc)

# Linting & Formatting (in-process serialized lint service)
bun run lint                   # Full-repo ESLint; in-process serialized lint service — safe for parallel sub-agents
bun run lint:fix               # Full-repo ESLint with auto-fix
bun lint:type-aware            # Type-aware ESLint (sonarjs rules requiring type context); use --fix to auto-fix
bun run format                 # Biome formatter
bun run biome:check            # Biome lint + format + unsafe fixes

# GraphQL Code Generation (REQUIRED after schema/document changes)
bun run generate:gqlSchema     # Generate GraphQL schema from Pothos
bun codegen                    # Generate TypeScript types from schema

# Testing (layer-specific)
bun run build:test             # Build production bundle for UI/E2E tests (.next-test-prod) — REQUIRED before test:ui:e2e
bun run test                   # All tests
bun run test:db                # Database repository tests (parallel via test/scripts/run-db-tests-parallel.ts)
bun run test:db:sequential     # Database tests (sequential, for debugging)
bun run test:integration       # Provider integration smokes (parallel via test/scripts/run-integration-tests-parallel.ts)
bun run test:integration:sequential  # Integration tests (sequential, for debugging)
bun run test:live-comm         # Communication provider integration subset
bun run test:live-fx           # FX provider integration subset
bun run test:services          # Backend services tests (parallel via test/scripts/run-services-tests-parallel.ts)
bun run test:services:sequential # Backend services tests (sequential, for debugging)
bun run test:graphql           # GraphQL integration tests (dev server via test/scripts/run-server-tests.ts)
bun run test:ui:components     # UI component tests (Happy DOM, no server)
bun run test:ui:e2e            # End-to-end tests (dev/production server — test/scripts/run-server-tests.ts --e2e)
bun run test:ui                # All UI tests (components + e2e + static)
bun run test:ui:kill           # Kill test servers on port 3099 only (never dev:3000 or start:4000)

# Run database tests with log capture (AI agents MUST use this instead of raw `bun test`)
bun run test/scripts/run-test.ts <test-path>        # Run with log capture
bun run test/scripts/run-test.ts --last <path>      # View last result (AI-optimized)
bun run test/scripts/run-test.ts --last --focus "<pattern>" <path>  # Filtered view

# Quality Gates
bun quality-gate               # Automated quality verification (tsgo → oxlint → biome → lint → duplicates)
bun quality-gate:fresh         # Reset state and run fresh

# Database
bun run db                      # Database actions via scripts/dbActions/ (generate, push, migrate, seed, studio — reset & cleanGenerate disabled by repo policy)
```

## Architecture Layers

The codebase follows strict layer separation. Each layer has its own `AGENTS.md` with detailed rules.

### Layer Hierarchy (read layer-specific AGENTS.md before working in each)

| Layer | Path | AGENTS.md Location |
|-------|------|-------------------|
| App Router | `app/` | `app/AGENTS.md` |
| Shared | `shared/` | `shared/AGENTS.md` |
| Frontend Views | `frontend/views/` | `frontend/views/AGENTS.md` |
| Frontend Stores | `frontend/stores/` | `frontend/stores/AGENTS.md` |
| Frontend GraphQL | `frontend/graphql/` | `frontend/graphql/AGENTS.md` |
| Backend Services | `backend/services/` | `backend/services/AGENTS.md` |
| Backend GraphQL/Pothos | `backend/graphql/` | `backend/graphql/AGENTS.md` |
| Database Repositories | `backend/db/repo/` | `backend/db/repo/AGENTS.md` |
| Database Seeds | `backend/db/seeds/` | `backend/db/seeds/AGENTS.md` |
| Backend Types | `backend/types/` | `backend/types/AGENTS.md` |
| Backend Enums | `backend/enum/` | `backend/enum/AGENTS.md` |

### Data Flow

```
Client Component → Apollo Hook → GraphQL API → Pothos Resolver → Service → Repository → Database
Server Component → Cached Wrapper → Service → Repository → Database
```

**Critical**: Server Components call services directly (not GraphQL). Client Components use Apollo hooks.

## Non-Obvious Patterns & Gotchas

### Next.js 16 Breaking Changes
This is NOT standard Next.js. APIs and conventions differ from training data. **Always read `node_modules/next/dist/docs/` before writing Next.js code.**

### Logging
- **NEVER use `console.*` directly** - ESLint will error
- Always use: `import { logger } from '@/frontend/utils/logger'` (frontend) or `@/backend/lib/logger` (backend)
- Methods: `logger.info`, `logger.warn`, `logger.error`, `logger.debug`, `logger.logDomainError`
- **Domain / Expected Rejections**: Use `logger.logDomainError(msg, ctx)` when handling business rejections, 4xx equivalents, `NotFoundError`, or `ValidationError`. It automatically logs as `debug` in test mode (`TEST_SERVER=1`) to keep test logs compact and as `warn` in production.

### MUI v9 Breaking Changes
- Style props (`fontWeight`, `textAlign`, `mb`, `mt`, `p`, `display`, etc.) are NOT valid direct props on Typography, Stack, Box, Grid
- Always use `sx` prop: `<Typography sx={{ fontWeight: 700, mb: 1 }}>`
- Icon naming changed: `*Outline` → `*Outlined` (e.g., `ErrorOutline` → `ErrorOutlined`)
- See `frontend/AGENTS.md` for complete list

### React 19 Changes
- `FormEvent` is deprecated/removed. Use `React.SubmitEvent` or `React.SyntheticEvent<HTMLFormElement>`
- Cast FormData results: `(formData.get("name") as string | null) ?? ""`

### Path Aliases
- The `@/*` path alias maps to the project root (`./`), configured in `tsconfig.json` under `compilerOptions.paths`
- All imports use this pattern: `import { logger } from "@/backend/lib"` (never relative paths)
- Examples: `@/backend/services/` → `./backend/services/`, `@/frontend/views/` → `./frontend/views/`

### Barrel Files (`index.ts`) Conventions
- **Shortest import path**: Always import from the highest available barrel (e.g. `@/backend/services`, not `@/backend/services/communication/channels/whatsapp/cloud-api`). If a barrel doesn't exist at the needed level, create one.
- **Nested barrels**: Every nested subdirectory that has exportable modules MUST have its own `index.ts`. Parent barrels re-export from nested barrels (`export * from "./subdir"`), never from nested files directly (`export * from "./subdir/file"` is prohibited).
- **Prefer `export *`**: Use `export * from "./module"` exclusively. Avoid named re-exports (`export { A, B } from "./module"`) unless two source files export the same symbol name (collision) — in that case, rename the function in the source file so `export *` works, rather than aliasing in the barrel.
- **`./` not `@/` in barrels**: `index.ts` files MUST use relative `./` paths, not `@/` path aliases. Example: `export * from "./requests"`, not `export * from "@/backend/services/.../requests"`.
- **No `../` in barrels**: `index.ts` files MUST NOT use `../` or `./../` — only `./` paths to files/subdirs in the same directory or one level down.
- **Max one `/` per path**: Each `export * from` path in an `index.ts` MUST NOT contain more than one `/`. Example: `export * from "./requests"` (one `/`) is allowed; `export * from "./requests/get-phone-number.request"` (two `/`) is prohibited — use `export * from "./requests"` and let the `requests/index.ts` barrel handle the rest.
- **No imports in barrels**: `index.ts` files contain ONLY `export *` (or collision-disambiguation `export { }`) statements — never `import` statements. The only exception is GraphQL mutation/query layers where imports register types in the GraphQL schema (not re-exported).
- **Unique export names**: When multiple files in the same directory export functions with the same generic name (e.g. `buildRequest`, `parseResponse`), rename them to unique descriptive names in the source files (e.g. `buildGetPhoneNumberRequest`, `parseGetPhoneNumberResponse`) so the barrel can use `export *` without aliasing.
- **Collision registry**: When `export *` causes a naming collision (TS2308 or ESLint `import-x/export`), keep `export { }` for the colliding symbol and document the exception in `ai/plans/reexport-elimination/outcome/collisions-registry.md`. See `docs/architecture/import-export-conventions.md` for full rules.
- **`export type { }` stays**: `export type { X } from "./file"` is NOT converted to `export *` — type-only re-exports are intentional and keep type semantics explicit.
- **No re-export shims**: Files that only re-export from another directory (`export { X } from "@/other/dir/file"`) are prohibited. Consumers must import directly from the original source. Delete shim files and update consumers.

### Shared Layer
- `shared/` is used by both frontend and backend — it must **never** import from `@/frontend/**`, `@/backend/**`, or `@/app/**` (ESLint enforced).
- Cross-layer enums and constants belong in `shared/constants/`; utilities in `shared/lib/`. See `shared/AGENTS.md`.

### Database Testing Critical Rules
- **ALWAYS use `runInRollback` wrapper** for database tests
- **ALWAYS pass `tx` to ALL repository methods** inside transactions - mixing `tx` queries with `db`-backed repo calls causes deadlocks
- **NEVER use `expect(...).rejects.toThrow()` inside `runInRollback`** - causes deadlocks. Use try/catch helper pattern instead
- **NEVER query seed data** - always create test data using helpers in `entity-setup.ts`
- Verify entity-setup helper signatures before use - they vary significantly

### GraphQL Document Conventions
- Documents live in `frontend/graphql/sharedDocuments/<domain>.documents.ts`
- Naming: `{entityName}QueryDocument`, `{entityName}MutationDocument`
- **Always include `id` field** on every object type for Apollo cache normalization
- **NO `useLazyQuery`** - use stateful `useQuery` exclusively
- Import hooks from `"@apollo/client/react"`, not `"@apollo/client"`

### Type Definition Pattern (CRITICAL)
All layers use types from `backend/types/{entity}.types.ts`:
- `{Entity}SelectType`, `{Entity}InsertType` - database types
- `{Entity}ReturnType`, `{Entity}SubmitInput` - service/API types
- `DBTransaction`, `DBQueryExecutor` - database transaction/executor types (now in `@/backend/types`, moved from `@/backend/db/db.types`)
- **Never create local type definitions in Pothos files** - always import from `@/backend/types`
- **Service-layer `.types.ts` files are prohibited** - all types live in `backend/types/`; split runtime code into `.helpers.ts`/`.constants.ts`
- Single canonical GraphQL object type per entity

### i18n / Localized Errors
- All user-facing error messages must use the **compile-time translation system** in `shared/locale/`
- **Server Components**: use `getTranslations(locale, "namespace")` from `@/shared/locale/server`
- **Client Components**: use `useAppTranslation("namespace")` from `@/shared/locale/client`
- **GraphQL Resolvers**: use `ctx.t("namespace")` — already bound to `ctx.locale`
- **API Routes / Scripts / Tests**: use `getServerTranslations(locale, "namespace")` from `@/shared/locale/server-graphql`
- **Pluralization**: define as `(count: number) => string` in type schema, implement in each locale file
- **Interpolation**: define as `(param: string, ...) => string` in type schema, implement with template literals
- **Never hardcode error strings** — always use typed translation functions
- The legacy `next-intl` package has been removed; all translation namespaces now live in `shared/locale/`. Never import `next-intl`, `getBackendTranslations`, or from `shared/messages/` (the directory no longer exists).

### Theme & Styling
- **NO hardcoded colors** - all colors from theme palette
- Use theme callback: `sx={(theme) => ({ color: theme.palette.primary.main })}`
- Use Material 3 `on<Color>` siblings for contrast (e.g., `theme.palette.onPrimary`)
- See `frontend/THEME_PALETTE.md` for tokens

## Code Quality Workflow

After making changes:
1. Run `bun quality-gate` - it handles tsgo, oxlint, biome, lint, duplicates sequentially
2. If DUPLICATES fails: run `bun run check:duplicates` to see cross-file clones. Fix by extracting shared scaffolds/utilities (see `docs/frontend/duplication-elimination-patterns.md`). NEVER add `jscpd:ignore` comments or modify `.jscpd.json`.
3. Re-run `bun quality-gate` to resume from last failed stage
4. Use `bun quality-gate:fresh` only for clean-slate verification

**⚠️ NEVER CLEAR CACHES.** Neither `quality-gate` nor `quality-loop` may ever clear cache files.
This includes:
- ESLint cache (`.eslintcache`, `.eslintcache-type-aware`) — always preserved by `lint-service.ts`
The `quality-gate:fresh` / `--fresh` flag only clears the quality-gate **state file**
(`.quality-gate-state.json`), which tracks stage progress — it does NOT touch any cache.
Never manually delete cache files either.

## Lint Service (In-Process Serialized ESLint)

The project uses a unified lint service (`scripts/lint-service.ts`) that provides both a CLI and programmatic API. It runs ESLint with serialized execution to prevent CPU/memory contention when multiple callers (e.g., sub-agents, quality-gate stages) lint concurrently within the same process. No HTTP server, no port binding — everything is in-process TypeScript.

### Running lint from the command line

**Full-repo lint** (via `eslint.config.js` `files`/`ignores` block):
```bash
bun run lint
```

**File-scoped lint** (faster when you only touched specific files):
```bash
bun run scripts/lint-service.ts -f <file1> -f <file2> --id <caller-id>
```

**Auto-fix mode**:
```bash
bun run lint:fix
```

**JSON output** (for scripting/automation):
```bash
bun run scripts/lint-service.ts -f <file> --json --id <caller-id>
# Returns: { success: boolean, output: string, exitCode: number, metrics: {...} }
```

The CLI exits with ESLint's exit code (0 = clean, 1 = lint errors, 2 = config/usage errors), so CI pipelines and quality gates detect failures correctly.

### Programmatic API (from TypeScript)

Import and call directly from scripts or tests:

```typescript
import { requestLint, requestFullRepoLint } from "@/scripts/lint-service";

// Lint specific files
const result = await requestLint("sub-loop", ["backend/types/foo.types.ts"]);
// Returns: { success: boolean, output: string, exitCode: number }

// Full-repo lint (empty files array)
const fullResult = await requestFullRepoLint("cli");
```

**When to use programmatic vs CLI:**
- Use the programmatic API when your script already runs in a Bun/Node process and can import TypeScript (e.g., `sub-loop.ts`, orchestrator scripts).
- Use the CLI when invoking from shell commands or external tools (e.g., GitHub Actions, pre-commit hooks, extensions).

### Environment Variables

- `LINT_QUEUE_CONCURRENCY` — ESLint `--concurrency` value (default: adaptive `1`–`4`, derived from CPU count and memory budget — prevents OOM-kills on memory-constrained hosts; set to `auto` to let ESLint decide).
- `LINT_MAX_OLD_SPACE_MB` — ESLint child heap cap in MB (default: adaptive, clamped to `2048`–`8192`). Note: with `--concurrency=N` the worst-case memory is `(N+1) × heap`, so lower concurrency on small hosts.
- `LINT_QUEUE_TIMEOUT_MS` — Per-request timeout in milliseconds (default: 300000 for file-scoped, 1200000 for full-repo).

### Other quality commands are safe to run in parallel

- `bun tsgo` — Safe to run concurrently (read-only type checker)
- `bun biome:check` — Safe to run concurrently (lightweight formatter/linter)
- `bun run test:*` — Safe to run concurrently (isolated test runners)
- `bun run lint` — Safe to run directly; uses the in-process service (no server startup required). When multiple callers import `requestLint()` in the same process, requests serialize through an in-memory FIFO queue.
- `bun run check:duplicates` — Uses process lock with dedicated `duplicates` namespace; serialized via `run-locked-cmd.ts`. Exempt from 5-minute timeout (full-repo scan of 3,000+ files). Sub-loop's per-file jscpd calls `bunx jscpd` directly (no lock needed for intra-file scans).

## Verification Loop (Per-File Level)

When refactoring or creating code, run a per-file verification loop **BEFORE** using the result elsewhere:

1. **After extracting a function** from one file to another: run tsgo + oxlint + biome + lint on the **new file containing the extracted function** BEFORE importing or using it elsewhere.
2. **After creating a new file**: run tsgo + oxlint + biome + lint on the new file BEFORE importing it anywhere.

```bash
bun tsgo                          # Type check (safe to run concurrently)
bun oxlint                         # Oxlint (fast linter, fails on warnings)
bun biome:check                   # Biome (safe to run concurrently)
# Lint the specific file:
bun run scripts/lint-service.ts -f <the-file> --id verify
```

This catches issues early at the file level before they propagate to the full quality gate.

## Test Runner for Refactoring

When refactoring or fixing a **test file**, use the run-test script instead of raw `bun test`:

```bash
bun run test/scripts/run-test.ts <test-path>                       # Run with log capture
bun run test/scripts/run-test.ts --last <test-path>               # View last result (AI-optimized)
bun run test/scripts/run-test.ts --last --focus "<pattern>" <test-path>  # Filtered view
```

The run-test script captures output to log files for easier debugging and is mandatory for database tests
(to capture deadlocks and transaction issues that raw `bun test` may swallow).

## Parallel Subagent Quality Gate Workflow

When running `bun quality-gate`, the orchestrator dispatches **parallel subagents** to fix files
within each lifecycle stage. Key rules:

### Lifecycle Isolation (No Cross-Stage Interleaving)

- Subagents are dispatched **per lifecycle stage only** — no mixing stages in the same wave
- Each stage must fully complete before advancing to the next
- Stage order: `tsgo` → `oxlint` → `biome:check` → `lint` → `duplicates`

### Subagent Dispatch Model

- **One subagent per file** — maximum parallelism
- **tsgo uses grouped parallel**: bundle related files (same import chain, same directory, same type
  dependency) into batches. Fix a batch in parallel, verify, then move to the next batch
- **oxlint/biome/lint/duplicates**: full parallel — all files at once

### Per-File Verification via `scripts/health/sub-loop.ts`

Each subagent calls the automation script to verify its file:

```bash
bun run scripts/health/sub-loop.ts <file-path> --lifecycle <stage>
```

The script runs a **progressive loop** (tsgo → oxlint → biome → lint → duplicates) and
**short-circuits at the first failing check**. The subagent fixes the errors and re-runs until
the script exits 0. The `--lifecycle` arg controls the target stage:

| `--lifecycle` | Checks run (in order) |
|---------------|----------------------|
| `tsgo` | tsgo only |
| `biome` | tsgo → oxlint → biome |
| `lint` | tsgo → oxlint → biome → lint (via queue client) |
| `duplicates` | tsgo → oxlint → biome → lint → check:duplicates |

**Progressive enforcement**: no skipping ahead. If tsgo fails, only fix tsgo — don't run
oxlint/biome/lint/duplicates until tsgo passes.

### Instruction File & AGENTS.md Discovery (Per-File)

The `scripts/health/sub-loop.ts` script automatically discovers and prints which instruction
files and AGENTS.md files apply to the target file. Subagents MUST read ALL listed files before
fixing. The mapping is:

**Instruction files** (`.github/instructions/*.instructions.md`):

| File Path Pattern | Instruction File |
|---|---|
| `frontend/**/*.ts(x)`, `app/**/*.ts(x)` | `frontend.instructions.md` |
| `backend/**/*.ts` | `backend.instructions.md` |
| `**/*.test.ts(x)`, `**/*.spec.ts(x)`, `scripts/run-test/**/*.ts` | `tests.instructions.md` |

A file may match **multiple** instruction files (e.g., `backend/db/test/*.test.ts` matches
both `backend.instructions.md` and `tests.instructions.md`). Read ALL matching files.

**AGENTS.md files** (in addition to root `AGENTS.md` which is always applicable):

| File Path Prefix | Additional AGENTS.md Files |
|---|---|
| `app/` | `app/AGENTS.md` |
| `shared/` | `shared/AGENTS.md` |
| `frontend/views/` | `frontend/views/AGENTS.md`, `frontend/AGENTS.md` |
| `frontend/stores/` | `frontend/stores/AGENTS.md`, `frontend/AGENTS.md` |
| `frontend/graphql/sharedDocuments/` | `frontend/graphql/sharedDocuments/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/AGENTS.md` |
| `frontend/graphql/` | `frontend/graphql/AGENTS.md`, `frontend/AGENTS.md` |
| `backend/services/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` |
| `backend/graphql/` | `backend/graphql/AGENTS.md`, `backend/AGENTS.md` |
| `backend/db/repo/` | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` |
| `backend/db/seeds/` | `backend/db/seeds/AGENTS.md`, `backend/AGENTS.md` |
| `backend/db/test/` | `backend/db/test/AGENTS.md`, `backend/AGENTS.md` |
| `backend/types/` | `backend/types/AGENTS.md`, `backend/AGENTS.md` |
| `scripts/run-test/` | `scripts/run-test/AGENTS.md` |

### Fix-Or-Report Rule for Cross-File Violations

After reading the applicable instruction files and AGENTS.md, subagents check for rule violations:
- **Fix within the SAME file**: if the violation can be fixed in the assigned file, fix it directly.
- **Report cross-file dependencies**: if fixing requires modifying ANOTHER file, do NOT modify it.
  Report to the orchestrator using:
  ```
  CROSS-FILE DEPENDENCY:
    Target file: <this file>
    Blocked by: <other file that needs changes>
    Rule violated: <which rule from instruction file or AGENTS.md>
    Required fix: <description of what the other file needs>
  ```
- **Never modify a file you were not assigned to.** The orchestrator coordinates multi-file changes
  by dispatching a follow-up subagent wave for the dependency files.

## AI Agent Communication Rules

- **NEVER create summary markdown files** (SUMMARY.md, CHANGES.md, REPORT.md, etc.)
- **DO respond in chat** with clear summary of what was done
- Exception: Documentation files that are part of project structure (README.md, CONTRIBUTING.md)

## File Organization

### Frontend
- `frontend/views/dashboard/` - Domain-organized page components
- `frontend/stores/` - Zustand stores (mock stores for Storybook)
- `frontend/components/ui/` - Shared UI components (AppDataGrid, MetricCard, PageContainer, etc.)
- `frontend/graphql/sharedDocuments/` - GraphQL documents by domain
- `frontend/graphql/generated/` - Auto-generated types (do not edit)

### Backend
- `backend/db/schema/` - Drizzle table definitions
- `backend/db/repo/` - Repository layer (data access only)
- `backend/services/` - Business logic, organized by domain
- `backend/graphql/pothos/` - Pothos GraphQL definitions
- `backend/types/` - Canonical type definitions
- `backend/lib/` - Utilities (auth, logger, env, etc.)

### Testing
- `backend/db/test/repo/` - Repository unit tests (100% coverage required)
- `backend/db/test/logic/` - Business logic integration tests
- `frontend/graphql/test/` - GraphQL integration tests (dev server; use testClient, not raw fetch)
- `test/ui/` - UI tests — see `test/ui/AGENTS.md`
- `test/ui/components/` - Component tests (Happy DOM + mocked Apollo; no server)
- `test/ui/e2e/` - End-to-end tests (production server; requires `bun run build:test` first)

## Important References

- `frontend/COMPONENT_PATTERNS.md` - Dashboard UI patterns
- `frontend/IMPLEMENTATION_LEARNINGS.md` - Error resolutions from past mistakes
- `frontend/NEW_PAGE_WORKFLOW.md` - Required workflow for new pages
- `frontend/THEME_PALETTE.md` - Color tokens and access patterns
- `docs/IDEMPOTENCY.md` - Idempotency patterns
- `docs/notifications/realtime-engine.md` - Real-time notification engine (WebSocket): persist-first/push-second, single-writer emit contract, sidecar topology, fail-open idempotency deviation
- `docs/drizzle/prepared-statements.md` - Drizzle Prepared Statements 2.0 pattern reference
- `docs/drizzle/neon-http-client.md` - Neon HTTP Client & Provider-Agnostic Stateless Queries reference
- `docs/graphql/dataloader-batching.md` - Pothos DataLoader batching pattern reference
- `docs/services/entity-cache-service.md` - Entity Cache Service pattern reference
- `docs/services/meeting-providers.md` - Meeting provider adapter/factory pattern reference (auto URL generation) *(doc file absent from this tree — pending the meeting-services ticket; see `ai/plans/dev3-002-shared-error-handling-response-contracts/deferred-items.md` BLT-03)*
- `docs/services/zoom-token-types.md` - Zoom token kinds (SDK JWT, OBF, ZAK, S2S OAuth, per-user OAuth) semantics and constraints
- `docs/services/whatsapp-cloud-api.md` - WhatsApp Cloud API integration reference (adapter, factory, webhook, dispatch, schema, opt-in, frontend) *(doc file absent from this tree — pending the WhatsApp-integration ticket; see `ai/plans/dev3-002-shared-error-handling-response-contracts/deferred-items.md` BLT-03)*
- `docs/services/general-user-creation.md` - General user creation pattern (createUserOfType null extension, specialized group filtering, cache eviction)
- `docs/billing/quota-system.md` - Quota System: append-only ledger, FIFO selection, periodic rollover, on-demand scheduling integration
- `.github/CODE_REVIEW_CHECKLIST.md` - Code review guidelines
- `docs/services/cron-service.md` - Cron service pattern reference
- `docs/frontend/ui-shared-scaffold-pattern.md` - UI Shared Scaffold (*Shared.tsx) pattern for common/desktop/mobile triplication
- `docs/frontend/duplication-elimination-patterns.md` - Duplication elimination patterns A-G (scaffold extraction, shared utility, dead code deletion, store consolidation, scaffold extension, shared view scaffold, locale type consolidation) — Phase 6 eliminated 96% of duplications (475→18 pairs) with zero jscpd:ignore
- `docs/frontend/meeting-integrations-ui.md` - Meeting Integrations UI canonical reference (MetricCardGrid, AppDataGrid, OAuth callback, reconnect-all, status badges, clipboard, i18n namespaces, mobile-desktop responsive, Zod schema factory, animations, permission-gated cross-links, lint workarounds, accessibility)
- `docs/frontend/whatsapp-ui-patterns.md` - WhatsApp UI canonical reference (ViewModel composable hooks, URL-synced tabs, dialog state, per-row loading, i18n label helpers, StatusBadge, animations, accessibility, testing patterns, gotchas)
- `docs/frontend/quota-ui-patterns.md` - Quota UI canonical reference (tier isolation, RHF 3-generic pattern, cache.updateQuery for paginated lists, StatusBadge categories, MetricCard animations, reduced-motion CSS in sx, Storybook ErrorState naming, component test tier-view mocking, i18n CLDR plurals, 150-line file limit, QuotaFormAccessProvider RBAC)
- `docs/testing/shared-test-runner.md` - Shared parallel test runner pattern
- `docs/backend/shared-types-pattern.md` - Cross-layer shared types in shared/types/
- `docs/backend/meeting-adapter-base.md` - Meeting provider adapter base class pattern reference
- `docs/backend/billing-repo-factory.md` - Billing repo factory with configurable hooks pattern reference
- `docs/backend/schema-helpers.md` - Schema column and junction table helpers pattern reference
- `docs/app/with-page-auth.md` - App router page auth wrapper pattern reference
- `docs/testing/mock-navigation-helpers.md` - Test mock navigation helpers pattern reference
- `docs/auth/manager-role-mapping.md` - Manager role mapping architecture & permission group slug convention
- `docs/i18n/locale-namespace-migration.md` - Locale namespace migration from monolithic to sub-module directories
- `docs/auth/permission-architecture.md` - Client-side permission architecture (3-tier model, wrapper removal rationale)
- `docs/auth/supervisor-permissions.md` - Supervisor permission model (teacher/student/parent management, staff exclusion, system group editing, authScope pattern)
- `docs/i18n/cross-layer-enum-migration.md` - Cross-layer enum delete/codemod pattern (currency/timezone/class-instance-detail workflow)
- `docs/backend/service-base-pattern.md` - Service base class, shared resolvers, insert payload builders, auth session helpers
- `docs/backend/types-consolidation.md` - Types consolidation: moving `.types.ts` from service layer to `backend/types/`, split rules, barrel conventions
- `docs/graphql/pothos-field-factories.md` - Pothos field helpers, input field helpers, and query field factory idioms
- `docs/architecture/import-export-conventions.md` - Import/export barrel conventions, `export *` rules, collision registry, re-export elimination summary
- `docs/quality/linting-rules.md` - Oxlint & ESLint/sonarjs lint rule fix recipes and config overrides
- `docs/quality/ci-pipeline.md` - CI pipeline canonical reference (.github/workflows/ci.yml trigger model, job/stage topology, caching rules, security posture, branch-protection admin setup, local reproduction commands, sabotage evidence)
- `docs/workflows/plan-doc-reconciliation.md` - Plan-vs-canonical-doc reconciliation workflow (docs-only plan pattern, anchor-on-text, outcome-pointer rule, known-open-issues propagation, phantom-spec-code handling, markdown link-integrity loop)
- `docs/backend/serverless-cold-start-optimization.md` - Serverless cold-start optimization patterns (permission context, env-config pre-warm, singleton persistence, HTTP batching, client log batching)
- `docs/backend/login-cold-start-resilience.md` - Login cold-start resilience patterns (fail-open rate limiter, retryTransient on DB reads, frontend retry on SERVICE_UNAVAILABLE, env-config transient short TTL) *(doc file absent from this tree — rule text lives in `backend/graphql/AGENTS.md` §Serverless Cold-Start Optimization; `SERVICE_UNAVAILABLE` transport semantics in `docs/graphql/error-handling-contract.md`; see dev3-002 BLT-03)*
- `docs/graphql/error-handling-contract.md` — Shared error handling & response contract: REQ-010 code↔HTTP taxonomy + legacy alias normalization, masking/redaction pipeline & correlation bounds, API envelope shapes `{data,requestId}` / `{error:{…}}` with exemptions register, REQ-061 client mapping table, and the per-guarantee test-suite matrix
- `docs/graphql/domain-error-extensions-code.md` - DomainError → GraphQLError extensions.code propagation pattern
- `docs/observability/new-relic-integration.md` - New Relic APM integration (Hybrid Agent, GraphQL resolver tracing, zero dev/test overhead)
- `docs/auth/user-registration.md` — User registration canonical reference (role→child mapping, handshake generation, atomicity pattern, BOPLA/BFLA defenses, 23505→ConflictError translation, JWT auth flow)
- `docs/auth/qiraah-selection-and-c5.md` — Qira'ah selection and the C.5 invariant (canonical RecitationReading catalog, public recitationReadings query, registration preferredRecitation contract, deferred persistence, security rules)
- `docs/auth/jwt-authentication-service.md` — JWT authentication service canonical reference (token claims contract, cookie matrix, redirect-loop fix, authScopes, SSR auth, page guards, role-based dashboards, DEV2-002 RBAC consumption guide)
- `docs/backend/cross-stream-contracts.md` — Cross-stream contract types canonical reference (DEV2-003: 6 contracts, composition-only rule, forbidden-field registry, consumer-ticket wiring, change governance)
- `docs/graphql/api-gateway-and-routing.md` — API gateway & routing canonical reference (dev3-003: seven-step request pipeline in `app/api/graphql/route.ts`, transport-failure matrix + `MAX_GRAPHQL_BODY_BYTES`, default-deny public-operation allowlist gate, the two sanctioned health probes, ROUTE_INVENTORY registration rule (A4), REQ-018 operation-registration contract)
- `docs/teachers/applicant-lifecycle.md` — Teacher applicant lifecycle canonical reference (DEV2-004: `applicants` state machine REQ-013, cooldown/attempt contracts REQ-014/015/016, zero-arg `myApplicantProfile` query contract REQ-017, INV-TV1..TV7 + B.6/B.7 anchoring, consumer guidance for DEV2-005..010/DEV3-019)
- `docs/admin/user-management.md` — Admin user-management canonical reference (DEV3-016: directory/filter/search contract incl. `escapeLikeWildcards` mandate, guarded soft-delete/reactivate pattern, role-child projection rules, audit-emission contract — writer-side, in-tx, denials write ZERO audit rows — JR-C-1, self-protection rule, `USER_NOT_FOUND` oracle ruling — admin-surface-only, MUST NOT be copy-pasted to non-admin surfaces, shared-PK "one user, four role children" model, idempotency ruling, scope-split record for DEV3-017..022b consumer obligations; A.5/A.7/B.6/B.7/INV-U1..U5/INV-TV1 + Workflow 05 anchoring)
- `docs/admin/account-governance.md` — Account governance canonical reference (DEV3-017: four-state lifecycle on `users`, guarded single-statement transitions + zero-row classifier + ONE in-tx audit row, suspend-window rules `1..3650` mandatory on ON direction, fail-closed shared suspension predicate at `backend/lib/auth/suspension-window.ts`, audit-vocabulary mapping for block/unblock via Suspend/Reactivate, axis independence, lapse = READ-ONLY on the auth path, strict `assertActiveActorAdmin` guard on governance mutations, INV-U4 hard-delete lock)
- `docs/parents/handshake-code-discovery.md` — Parent handshake-code discovery canonical reference (code format + generation contract by reference, minimal masked payload with no `id`, governance-exclusion collapse, null-not-error not-found, advisory `linkable` semantics, binding link-request forward contract, brute-force posture)
- `docs/students/free-trial-provisioning.md` — Free Trial Provisioning canonical reference (one-time trial credit grant for new students, dedicated `balance_trial` lane, grant-once guarded UPDATE, DEV3 booking-eligibility & decrement forward contract)
- `docs/sessions/session-lifecycle.md` — Session lifecycle canonical reference (DEV3-004: state machine + guarded-transition pattern, four-phase creation invariant, hold-as-debit + same-lane refund, idempotency claim design, sessions-are-sensitive oracle ruling + anti-copy-paste warning, consumer guidance for DEV3-005/006/011/012/013/021 + DEV2-016)


## Linting Rules

- **Oxlint & ESLint/sonarjs fix recipes**: See `docs/quality/linting-rules.md` for all lint rule patterns, code examples, and config overrides. NEVER add `oxlint-disable` comments — fix the root cause.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
