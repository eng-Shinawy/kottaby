# Requirements & Specification: DEV1-013 — Student Handshake Code Generation

> **Target ticket:** `[DEV1-013] Student Handshake Code Generation` (Owner: Dev 1 · Sprint 3 · 2 SP)
> **Plan directory:** `ai/plans/dev1-013-student-handshake-code-generation/`
> **Blocking dependencies:** DEV1-001 (`students.handshake_code` unique + NOT NULL columns, `students.parent_id` FK, `users` governance fields), DEV1-002 (registration path — handshake generation with bounded in-transaction retry is ALREADY shipped; see `docs/auth/user-registration.md` §2), DEV2-001 (verified `ctx.user`/`ctx.role`), DEV2-002 (`role`/`authenticated` authScopes, fail-closed context).
> **Critical reconciliation note:** Per the Existing Codebase State rule and `docs/auth/user-registration.md` §2, **handshake code generation is already implemented**: every student registration generates `KSB-<8 uppercase hex chars>` via `generateHandshakeCode()`, inserts it in the same atomic registration transaction, retries bounded-5 on `23505` collisions, and the DB enforces `handshake_code UNIQUE NOT NULL` (DEV1-001). DEV1-013 SHALL NOT re-plan or rebuild that path. This ticket's net-new scope is: (a) **permanent test locks** on generation/format/uniqueness/nullability/immutability, (b) the **student self-service read** (`myHandshakeCode`), and (c) the **parent discovery query** (`findStudentByHandshakeCode`) returning the deliberate **limited, ID-free confirmation payload** required by Workflow 04 §4.2 ("limited matching information … without exposing full student data"). The actual link-request write (7-day expiry, confirm workflow) is DEV1-014/DEV1-015 territory and is NOT in scope.

---

## 1. Executive Summary & Problem Statement

- **Feature**: The handshake-code substrate of the Parent Supervision pillar (Workflow 04). DEV1-013 locks the DEV1-002 generation contract as permanent tests, exposes the code to its owning student ("view your code to share it out-of-band"), and ships the parent-facing **search-by-code discovery contract** — the first step of the handshake journey: *parent enters code → system confirms the matching child with masked, minimal identity data and a linkable-state signal*. Everything after discovery (send request, expiry, confirm, monitoring) is owned by DEV1-014..017.
- **Problem from user perspective**:
  - **Student (Yusuf)**: must be able to *see* his handshake code in his own profile so he can share it with his parent out-of-band (the code is meaningless if the student cannot read it); after sharing, he must be assured the code reveals nothing beyond minimal identity confirmation until he explicitly confirms the link (INV-P1).
  - **Parent (Fatima)**: enters the code her child gave her and must get a truthful answer — "a child matching this code exists, this is them (masked), and they can be linked" — versus a clean "no student found", without ever receiving the child's full name, contact details, balances, session history, or any parent PII of an already-linked child.
  - **Super Admin / Platform integrity**: code-space brute-forcing must be mitigated (parent-role gate + minimal payload + rate posture), the code must be unique forever (B.12/B.13 depend on it), and governance states (deleted/blocked/suspended child accounts) must make the child **unfindable** (soft-deleted account ⇒ parent loses access immediately — Workflow 04 resolved rulings).
  - **Dev 1 (DEV1-014/015/016/017) / Dev 3 (DEV3-010/011)**: need the frozen discovery contract NOW — the link mutation, its expiry engine, and the notification payload (A.4) all consume this ticket's lookup semantics rather than re-deriving them.
- **Business value**: The handshake is the gateway to the entire M3 parent-portal milestone and its revenues-adjacent trust story ("parents watch their children learn"). Shipping discovery with a deliberately minimal payload converts the top PII-leak risk of the supervision feature into a structurally small surface, while the permanent uniqueness/format locks protect DEV1-014's link state machine (`pending → confirmed`, B.14 expiry) from corrupt keys.
- **Actors involved**:
  - **Student (caller)**: reads own handshake code (self-service, `ctx.user.id`-bound).
  - **Parent (caller)**: searches by a code obtained out-of-band; receives masked confirmation payload only.
  - **System**: generates the code during registration (existing DEV1-002 path — verified, not modified).
  - **Downstream consumers**: DEV1-014 (link request — MUST re-resolve by code server-side; the discovery payload carries **no database id**), DEV1-015 (confirm/reject), DEV1-016/017 (portal + notifications), DEV3-020-style audit posture is N/A here (no admin action).
  - **Explicitly NOT actors**: teachers, admins, supervisors, anonymous callers — no read access is granted to them in this ticket.
- **Non-goals** (explicitly OUT of scope for DEV1-013):
  1. **Link-request creation/mutation** (`students.parent_id` writes, `link_status`, 7-day expiry timer) — DEV1-014.
  2. **Student confirm/reject of a link request + notifications to parent** — DEV1-015 / DEV3-010.
  3. **Parent monitoring portal** (sessions/reports/homework/progress reads) — DEV1-016/017.
  4. **Any schema change** — `students.handshake_code`, `students.parent_id`, and all `users` governance fields already exist (DEV1-001); `git diff backend/db/schema/**` SHALL be empty.
  5. **Handshake regeneration / rotation / custom codes** — codes are immutable by construction (no mutation surface exists or is added).
  6. **Multi-code / code history** and **admin-set codes** — B.6-family direct-onboarding flows (DEV3-019) will generate through the shared service entry point when they create students.
  7. **Real per-IP rate limiting** for the search endpoint — inherits the platform's fail-open stub posture (DEV2-002 ownership); the abuse defense here is role gating + minimal payload (recorded as a documented forward note, not a ledger blocker).
  8. **Any notification rows** (A.4 consumption is DEV3-010/011) and **any session/report/homework reads** (parent read-only surfaces are DEV1-016).

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger)**: WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`, `git diff --name-only`) AND SHALL initialize `ai/plans/dev1-013-student-handshake-code-generation/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, pre-seeded with non-blocking forward entries: **D1** (link-request mutation wiring — the parent page's eventual "Send link request" CTA → target DEV1-014), **D2** (real search rate limiting per parent/IP → target DEV2-002 rate-limiter stream), and **D3** (direct-onboarding code generation reuse for DEV3-019 → consumed via the same `generateHandshakeCode` service entry point) ; AND SHALL write `outcome/phase0-baseline-outcome.md`.
- **REQ-002 (Type-Safe i18n & Enum Value Imports Compliance)**:
  - Client components MUST use `useAppTranslation(Translation.<Namespace>)` with the `Translation` enum and property access (`t.propertyName`), never string-literal namespaces or `t('key')` function calls.
  - Server components MUST use `await getTranslations(locale)` (single argument) and property access.
  - GraphQL resolvers MUST use `ctx.t("<namespace>")`; services/repositories MUST use `getServerTranslations(locale, "<namespace>")` from `@/shared/locale/server-graphql`.
  - All enum usages in runtime expressions/casts (`UserRole.Student`, `UserRole.Parent`) MUST be **value imports** (never `import type`) and enum members, never raw string literals.
  - FORBIDDEN: `next-intl` imports, `getBackendTranslations`, `shared/messages/` references, any hardcoded user-facing string.
- **REQ-003 (Canonical Types Discipline)**: Entity types MUST come from canonical locations: extend `backend/types/students/student.types.ts` (existing `StudentSelectType`/`StudentInsertType`) with this ticket's additive return shapes (composition-only via `Pick`/indexed access per the DEV2-003 contract rule); `DBTransaction` from `@/backend/types`. NO local type definitions in Pothos files, NO service-layer `.types.ts` files, NO new entity `.types.ts` file unless a genuinely new table exists (none does).
- **REQ-004 (Dependency Guard — Reuse, Don't Rebuild)**: WHEN domain work starts THEN the agent SHALL verify and NOT reimplement: `students.handshake_code` UNIQUE NOT NULL (`backend/db/schema/students/students.ts`), the existing `generateHandshakeCode()` + bounded retry inside `RegistrationService`/`StudentRepository.createForRegistration` (`docs/auth/user-registration.md` §2), `users` governance columns, and the DEV2-002 `role`/`authenticated` scopes. IF any required artifact is missing THEN the agent SHALL record a ❌ entry in `deferred-items.md` and block dependent tasks — never patching DEV1-001/DEV1-002-owned files inline.

### 2.2 Core Feature Logic / Happy Paths

- **REQ-010 (Generation Contract — Locked, Not Rebuilt)**: WHEN the permanent test suite runs THEN it SHALL assert that `registerUser(role=student)` creates a `students` row whose `handshakeCode` matches EXACTLY `^KSB-[0-9A-F]{8}$`, is non-null, and is produced inside the existing registration transaction with zero modification to the generation code. The implementation SHALL NOT modify the DEV1-002 generation path unless a defect is proven by these tests.
- **REQ-011 (Format Canonical Constant)**: WHEN any layer reasons about code shape THEN the canonical pattern SHALL live in ONE place (`shared/constants/handshake-code.constants.ts`: `HANDSHAKE_CODE_PATTERN = /^KSB-[0-9A-F]{8}$/` plus `isHandshakeCode(value: unknown): value is string` guard and the `HANDSHAKE_CODE_PREFIX = "KSB-"` builder constant), shared-layer-pure (NO imports from `@/backend/**`/`@/frontend/**`/`@/app/**`), consumed by both the existing service-side sanity checks and the new validation path. The DEV1-002 generator MAY be refactored to consume the shared builder **only if** its emitted format stays byte-identical and its test locks stay green.
- **REQ-012 (Uniqueness & NOT NULL — DB-Level Proof Locks)**: WHEN DB tests execute THEN they SHALL prove via `expectRepoError` that (a) a manually forced duplicate `handshakeCode` insert/update is rejected by the unique constraint, and (b) a NULL `handshakeCode` insert is rejected — both inside `runInRollback` with `tx` propagation, never relying on application code for enforcement.
- **REQ-013 (Immutability — No Rewrite Surface)**: WHEN the GraphQL schema and service layer are audited THEN there SHALL exist NO mutation, service method, or repository method that updates `handshakeCode` post-creation; a static scan SHALL assert zero writes to the column outside the registration insert path (the retry loop's repeated inserts are part of creation, not mutation).
- **REQ-014 (Student Self-Service Read)**: WHEN an authenticated caller with `role = student` invokes `myHandshakeCode` THEN the system SHALL return the caller's own `handshakeCode` derived EXCLUSIVELY from `ctx.user.id` (shared PK ≡ `students.id`) — a zero-argument query accepting NO input. IF the caller has no `students` row (registration defect edge) THEN the service SHALL throw `NotFoundError("STUDENT", …)` → `STUDENT_NOT_FOUND`.
- **REQ-015 (Parent Discovery Query)**: WHEN an authenticated caller with `role = parent` invokes `findStudentByHandshakeCode(code: String!)` with a syntactically valid code THEN the system SHALL resolve at most one `students` row (uniqueness is DB-enforced) and SHALL return the limited confirmation payload `HandshakeCodeLookup`: `{ maskedName: String!, linkable: Boolean! }` — nothing else.
- **REQ-016 (Not-Found Is a Nullable Payload, Not an Error)**: WHEN the code is syntactically valid but matches no eligible student (nonexistent, or governance-excluded per REQ-021) THEN the query SHALL return `null` (NOT an error) — discovery misses are a first-class UI state, mirror the DEV2-004 null-precedence precedent, and leak no governance clue beyond the sanctioned null.
- **REQ-017 (Masked Identity Payload)**: WHEN a lookup succeeds THEN `maskedName` SHALL be computed server-side as a deterministic mask of the student's `users.fullName` (first Unicode grapheme of each whitespace-separated name part, remainder replaced by a fixed mask character cluster — e.g., `A***‏ M***`) via a PURE shared helper (`shared/lib/mask-full-name.ts`), returning the SAME mask for the same input regardless of locale, correctly handling Arabic/RTL names, single-part names, extra whitespace, and emoji/combining-mark graphemes without throwing.
- **REQ-018 (Linkable Flag — B.12 Enforcement Signal)**: WHEN a lookup succeeds THEN `linkable` SHALL be computed as `student.parentId IS NULL` — a student already linked to a parent SHALL resolve with `linkable: false` so the UI (and, later, DEV1-014's server-side re-check) can present the "already linked" state. The raw `parentId` value SHALL NEVER appear in the payload.
- **REQ-019 (No Database Identity in Payload)**: WHEN the lookup payload is constructed THEN it SHALL contain NO database identifiers (no `students.id`, no `users.id`), NO contact fields (no email/phone), NO balances/governance/session data; DEV1-014's link mutation SHALL re-resolve the student by re-submitting the handshake code (the code is the capability reference across steps), which this ticket SHALL document as a binding forward contract.
- **REQ-020 (Input Normalization Then Validation)**: WHEN the parent search input is processed THEN the service SHALL first normalize (`trim`, then uppercase) and THEN validate against `HANDSHAKE_CODE_PATTERN`; malformed inputs SHALL fail BEFORE any DB read with `ValidationError` (`VALIDATION` semantics, localized `handshakeCodeInvalid` key) — case-variants of a valid code (`ksb-abcd1234`) normalize to a valid lookup; structural garbage (`KSB-`, `KSB-TOOLONG99`, unicode, LIKE wildcards `%`/`_`/`\`) fails closed.
- **REQ-021 (Governance Exclusion From Discovery)**: WHEN a lookup matches a `students` row whose linked `users` row is `isDeleted = true`, `isBlocked = true`, or actively suspended THEN the system SHALL behave exactly as if the student did not exist (REQ-016 null) — soft-deleted children are unfoundable by parents (Workflow 04 resolved ruling: parent loses access immediately), and no distinction between "never existed" and "governed" may be observable.
- **REQ-022 (Code Is the Only Search Dimension)**: WHEN the discovery surface is inspected THEN it SHALL offer NO search by name, email, phone, country, or any fuzzy/LIKE dimension; the only accepted key is the exact (normalized) handshake code. `escapeLikeWildcards` is documented as **not applicable** because no LIKE/ILIKE query exists (recorded so pentester waves don't flag absence as a gap).
- **REQ-023 (Code Read-Only in Every Direction)**: WHEN the student self-view or parent discovery executes THEN neither path SHALL write any row (pure reads), and no audit/notification/analytics row SHALL be emitted as a side effect of a lookup in this ticket.
- **REQ-024 (Code Space & Collision Posture — Documented)**: WHEN the canonical doc is written THEN it SHALL record the collision model from `docs/auth/user-registration.md` §2 (16⁸ ≈ 4.3B space, in-transaction bounded retry on 23505, `ConflictError` on exhaustion) and the brute-force economics of the search surface (parent-role gate, negligible payload value, future real rate limiter via DEV2-002 — deferred note D2), without changing any of it.
- **REQ-025 (Seed Parity — No Seed Changes Required)**: WHEN seeds run THEN existing student seed paths already produce codes via the production registration services; this ticket SHALL introduce NO new seed logic and SHALL prove discovery against `entity-setup.ts`-created fixtures only (never seed data, per `backend/db/test/AGENTS.md` rule 15).

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (BOLA / IDOR — Identity From Context; Code-As-Capability Deliberate)**: WHEN `myHandshakeCode` executes THEN identity SHALL come only from `ctx.user.id` (no arguments exist). WHEN `findStudentByHandshakeCode` executes THEN the design SHALL treat the code itself as the out-of-band capability (the legitimate parent learned it from the child); the query SHALL be parent-role-gated, the payload SHALL be minimal (REQ-017/019), and non-parent authenticated roles SHALL receive `FORBIDDEN` before any read executes.
- **REQ-031 (BFLA — Exact Role Gates)**: WHEN scopes are declared THEN `myHandshakeCode` SHALL carry `authScopes: { authenticated: true, role: [UserRole.Student] }` and `findStudentByHandshakeCode` SHALL carry `authScopes: { authenticated: true, role: [UserRole.Parent] }`; anonymous callers → `UNAUTHORIZED` (401 semantics); authenticated wrong-role callers (incl. teacher, admin, supervisor, and the sibling role on each query) → `FORBIDDEN` (403 semantics). NO admin/supervisor read override exists in this ticket (admin CRUD surfaces belong to DEV3-016-era tickets).
- **REQ-032 (BOPLA — Trivially Closed Inputs)**: WHEN inputs are consumed THEN the only client-controlled value is the `code` string (single scalar); typed input structurally cannot carry extra fields; no `{ ...input }` spread pattern exists anywhere in the ticket's code (grep-verified).
- **REQ-033 (No Existence Oracle Beyond Sanctioned Discovery)**: WHEN discovery denies/empties THEN the ONLY sanctioned information channel is: valid-format code → (`null` | masked payload). All governance denials collapse into `null` (REQ-021); all role failures are the canonical localized `FORBIDDEN`; masked names NEVER reveal the linked-parent identity, and `linkable: false` reveals only the minimal fact required by the UX ("this child already has a linked parent"), which any future claimant-parent needs to know without learning WHICH parent.
- **REQ-034 (Rate-Limit Posture — Inherited + Forward Note)**: WHEN the search query is exposed THEN it SHALL rely on the existing platform global/fail-open stub posture (unchanged, DEV2-002 owns real limits); this ticket SHALL additionally record (canonical doc + deferred note D2) that iterative code-space probing is a recognized residual risk whose practical mitigations already shipped are: parent-role gate, minimal payload, unguessable 32-bit-hex keyspace, and the DEV1-014 server-side re-validation on actual link attempts.
- **REQ-035 (Injection Surface — None)**: WHEN the lookup executes THEN it SHALL be a single parameterized equality query (`WHERE handshake_code = $1` via Drizzle) after regex validation; NO string concatenation, no `sql`-template interpolation of the input, no LIKE/ILIKE, and NO inline `--` comments inside any `sql` template (parameter-binding rule). Malformed input fails before the DB (REQ-020).

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (Generation Atomicity Is Inherited, Not Re-Opened)**: WHEN registration runs THEN the code generation + student insert SHALL remain inside the existing DEV1-002 `withTransaction(outerTx)` SAVEPOINT-aware transaction; DEV1-013 SHALL only lock it: the forced child-insert-failure test SHALL prove zero residual `users`/`students` rows.
- **REQ-041 (Duplicate-Collision Race Proof)**: WHEN the uniqueness contract is stress-tested THEN two concurrent registration flows within `runInRollback`-safe boundaries (or two forced-colliding direct inserts) SHALL prove that the DB unique constraint — not application timing — is the arbiter: exactly one write wins, the loser surfaces the translated `23505` path, and the existing retry loop can absorb collisions (the existing retry behavior is verified, not modified).
- **REQ-042 (Read-Only Query Discipline)**: WHEN the lookup/self-read methods are implemented THEN they SHALL follow the repository read conventions (`queryDb(tx)` Neon-HTTP-eligible pattern per `backend/db/repo/AGENTS.md`; single-scalar equality ⇒ NO `inArray` interaction and NO prepared-statement constraint violation), SHALL accept `tx?: DBTransaction` optional-last, and SHALL acquire NO locks (reads create no TOCTOU-sensitive state — link-state races are DEV1-014's transactional concern; documented).
- **REQ-043 (tx Propagation)**: WHEN any repository method participates in flows touched by this ticket THEN every repository call SHALL receive the same `tx` where a tx exists; mixing `tx` and global-`db` calls inside one logical operation is PROHIBITED.
- **REQ-044 (Negative Cache Prohibition)**: WHEN repeated misses occur THEN the system SHALL NOT cache "not found" results in any layer — a code looked up before its student's creation must succeed immediately after creation (no negative-cache staleness). No caching of positive payloads is introduced either (fresh governance/linkable state per call).
- **REQ-045 (Schema Zero-Drift)**: WHEN implementation completes THEN `git diff` on `backend/db/schema/**` and `backend/db/migration/**` SHALL be empty; `db push`/`db migrate`/`db reset`/`db cleanGenerate` are NOT invoked by this ticket.

### 2.5 Validation & Error Contracts

- **REQ-050 (DomainError Discipline)**: WHEN any failure surfaces THEN it SHALL be a `DomainError` subclass propagated with `extensions.code` per `docs/graphql/domain-error-extensions-code.md` and the DEV3-002 taxonomy: malformed code → `ValidationError` (`VALIDATION`); missing own student row → `NotFoundError("STUDENT", msg)` → `STUDENT_NOT_FOUND` (entity-name form, never the full code); auth layer → `UNAUTHORIZED`/`FORBIDDEN` from the scope layer. Plain `new Error(...)` is PROHIBITED.
- **REQ-051 (Localized Keys — Registered In All Locale Contracts)**: WHEN messages are produced THEN the new keys SHALL be added per `shared/locale/AGENTS.md`: in the `errors` namespace contract triple — `handshakeCodeInvalid`, `studentHandshakeNotFound` (service-side `STUDENT_NOT_FOUND` message source); and in the student/parent-facing UI namespace(s) — discovery page copy (title, input label, invalid-format helper, not-found message, found masked presentation, already-linked explanation, your-code card copy, copy-button label + copied confirmation). ar + en parity is compile-gated via `MessageSchema`; property access only, never `t('...')`.
- **REQ-052 (Logging Discipline)**: WHEN expected rejections occur (malformed code, missing own row) THEN they SHALL be logged via `logger.logDomainError` with bounded structured context (`code`, `entity: "students"`, entity id when known) — NEVER `console.*`; the raw submitted `code` SHALL be logged only after validation success or elided entirely (never log unbounded attacker input at INFO+ levels); unexpected failures use `logger.error` and mask at the DEV3-002 boundary.
- **REQ-053 (Silent Happy Path)**: WHEN a valid lookup or self-read succeeds THEN no error/warning/swallowed-catch SHALL be emitted; the flows are first-class contracts, not side effects.
- **REQ-054 (Mask Purity)**: WHEN `maskFullName` executes THEN it SHALL be a pure total function (`string => string`, never throws, no I/O, no locale/network dependency), with 100% branch coverage including empty-after-trim input (returns a fixed placeholder mask marker) and single-grapheme names.

### 2.6 GraphQL & Frontend Contracts

- **REQ-060 (Exact GraphQL Surface)**: WHEN the schema is built THEN it SHALL gain EXACTLY:
  ```graphql
  extend type Query {
    myHandshakeCode: String!
    findStudentByHandshakeCode(code: String!): HandshakeCodeLookup
  }
  type HandshakeCodeLookup {
    maskedName: String!
    linkable: Boolean!
  }
  ```
  with the authScopes of REQ-031; resolvers SHALL be thin (locale propagation + service delegation, top-level static imports only — Bun ESM rule, never `await import` inside resolvers); NO mutations are added; NO existing operation is modified.
- **REQ-061 (Canonical Object & Embedded-Type Rules)**: WHEN the Pothos object is defined THEN `HandshakeCodeLookup` SHALL be backed by the canonical return type from `backend/types/students/student.types.ts` (no local types) and SHALL declare NO `id` field BY DESIGN (REQ-019); the frontend Apollo cache SHALL register it as an embedded value type with `keyFields: false` in `frontend/providers/apollo/apolloCache.ts` `typePolicies` (and the `frontend/graphql/AGENTS.md` embedded-types list SHALL gain the entry) so no "cache data may be lost" normalization warning occurs.
- **REQ-062 (Codegen Sync)**: WHEN the Pothos artifacts land THEN the agent SHALL run `bun run generate:gqlSchema && bun codegen` and commit generated artifacts in the SAME change set; schema diff SHALL contain ONLY this ticket's additions.
- **REQ-063 (Frontend Documents)**: WHEN documents are authored THEN they SHALL live in `frontend/graphql/sharedDocuments/students/handshake-code.documents.ts` as `myHandshakeCodeQueryDocument` and `findStudentByHandshakeCodeQueryDocument` (`TypedDocumentNode<…>` from `@apollo/client`, codegen types only, imported from `@apollo/client` — never `/core`), registered through the `students` sub-directory barrel per `frontend/graphql/sharedDocuments/AGENTS.md`; `useQuery`/`useMutation` hooks come from `@apollo/client/react`; NO `useLazyQuery` anywhere — the parent search field SHALL trigger via a stateful `useQuery` gated by a validated-code state variable (skip/variables pattern), and the student card uses plain `useQuery`.
- **REQ-064 (Routes, Guards & Navigation)**: WHEN frontend pages ship THEN: (a) the student surface is an additive "Handshake Code" card inside the existing student profile/dashboard view (`app/(dashboard)/student/...` — reusing the existing page; NO new student route unless that section structure requires one, in which case it follows the same directory conventions); (b) the parent surface is one new page `app/(dashboard)/parent/handshake/page.tsx` guarded server-side via the existing page-auth wrapper with `roles: [UserRole.Parent]` (anonymous → `/login?redirect=…`, wrong role → `/dashboard`); the parent's sidebar/navigation SHALL gain the corresponding translated item in the parent nav grouping only; mobile bottom nav unchanged unless the parent's nav contract already reserves the slot.
- **REQ-065 (Per-Audience Rendering Matrix)**: WHEN the surfaces render THEN the following SHALL hold and be component/integration-tested:

  | Audience | Student "Your Code" card | Parent discovery page |
  |---|---|---|
  | Student | ✅ code + copy affordance | server-redirect to `/dashboard` |
  | Parent | server-redirect to `/dashboard` | ✅ search flow |
  | Teacher / Admin / Supervisor | redirect `/dashboard` | redirect `/dashboard` |
  | Anonymous | redirect `/login` | redirect `/login` |

- **REQ-066 (MUI v9 / React 19 / RTL Discipline)**: WHEN any frontend file is authored THEN all styling SHALL be inside `sx` (no direct style props on Typography/Box/Stack/Grid); icons SHALL use `*Outlined` naming; colors SHALL come from `theme.palette.*` via the theme-callback pattern; forms SHALL use `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>` (never `FormEvent`); error inputs SHALL carry `aria-invalid={!!error}`; Arabic/RTL rendering SHALL mirror layout via logical properties and preserve masked-name readability; loading/pending SHALL use existing skeleton conventions; and denial surfaces SHALL use the existing `PermissionDeniedFallback`-style pattern where client-side section denial applies (page-level denial remains SSR-owned).
- **REQ-067 (Error/Outcome Rendering)**: WHEN GraphQL outcomes render THEN consumers SHALL branch on `extensions.code` per the DEV3-002 error-handling contract (never HTTP status): `VALIDATION` → inline input error, `FORBIDDEN` → localized deny fallback/toast, null payload → localized "no student found" inline state (distinct from error styling), success → masked-name card with `linkable`-driven copy (the actual "Send link request" CTA is NOT rendered — deferred item D1 for DEV1-014). The copy-to-clipboard affordance SHALL use `navigator.clipboard` with a graceful fallback and localized "copied" confirmation.

### 2.7 Test Coverage

- **REQ-070 (Coverage Bar)**: WHEN new code ships THEN all new service/repository/helper modules SHALL reach 100% statement and branch coverage (`bun test --coverage` evidence in outcomes), including every mask edge case and every validation branch.
- **REQ-071 (DB Test Discipline)**: WHEN DB tests execute THEN every test SHALL run inside `runInRollback`, pass `tx` to ALL repository/Drizzle calls (param positions verified per signature), create entities exclusively via `entity-setup.ts` helpers (never seed data), assert failures via the `expectRepoError` try/catch helper against TRANSLATED-message substrings (never raw keys), NEVER use `expect(...).rejects.toThrow()` inside `runInRollback`, and SHALL run via `bun run scripts/run-test/run-test.ts <path>`.
- **REQ-072 (Generation & Constraint Lock Tests)**: WHEN the locks run THEN they SHALL prove REQ-010..013: format regex match on generated codes across N=50 registrations-fixture creates, exact-defaults on the students row, forced duplicate code rejection (`expectRepoError` + constraint substring), NULL rejection, forced-failure rollback with zero residuals, and the REQ-041 collision path through the existing retry loop (forced colliding generator via the documented injection seam of the existing implementation, or direct constrained inserts — agent's choice THAT DOES NOT modify production code semantics).
- **REQ-073 (Service Lookup Matrix)**: WHEN service tests run THEN they SHALL prove, with fixtures only: valid hit → masked name + `linkable=true`; already-linked (set `parentId`) → `linkable: false` and NO raw `parentId` leakage; nonexistent code → `null`; `isDeleted` / `isBlocked` / actively-suspended child → `null` indistinguishable from nonexistent (all three collapse into the SAME observable outcome); normalization acceptance (`ksb-ab…` lowercase input finds uppercase row); malformed inputs rejected pre-DB (`VALIDATION`) including `%KSB-…`, unicode, RTL payloads, empty, whitespace, over/under-length.
- **REQ-074 (GraphQL Integration Matrix)**: WHEN GraphQL tests run (`setupTestServerLifecycle` + `testClient`) THEN they SHALL assert every REQ-031/065 cell (`UNAUTHORIZED`/`FORBIDDEN` per role on both queries, including the *sibling-role* denials — parent on `myHandshakeCode`, student on the search), the happy-path payload shape (exactly `{ maskedName, linkable }` — a forbidden-key assertions scan SHALL prove `id`/`email`/`phone`/`parentId` absence), `myHandshakeCode` self-identity correctness (a second student fixture never sees the first's code), and `extensions.code` correctness on the failure cells via `CombinedGraphQLErrors`/`expectMutationError`-class helpers.
- **REQ-075 (Component Tests — Both Surfaces)**: WHEN component tests run THEN Happy DOM + Apollo mocks SHALL verify: student card renders the code from translation-preloaded labels (`readTranslation(handle, locale)` + `TestWrapper locale` + `translation-preload.ts`), copy affordance state transition, parent search input → `VALIDATION` inline helper on bad code, not-found inline state on `null`, found state with masked name + "already linked" copy when `linkable=false`, all assertions translation-driven with ZERO hardcoded strings, executed via the sanctioned component runner.
- **REQ-076 (Baseline Delta & Quality Gates)**: WHEN the ticket completes THEN `bun tsgo`/`biome:check`/lint counts SHALL equal the REQ-001 baseline plus zero NEW findings; every created/modified file SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` with exit 0; the REQ-045 empty schema diff and REQ-062 codegen diff discipline SHALL be evidenced in outcomes.
- **REQ-077 (Cross-Actor Journey Test — `test/workflows/`)**: WHEN the discovery journey ships THEN a journey test `test/workflows/parents/handshake-discovery.test.ts` SHALL execute the Section 2.9 journey against REAL services on the REAL test DB: sequential, actor-attributed steps (fixtures committed in `beforeAll`, hard-deleted in `afterAll` with tracked IDs, `runInRollback` FORBIDDEN since services spawn their own transactions, notification side effects — none today — configured to remain absent per REQ-023). IF the `test/workflows/` harness does not yet exist THEN the plan SHALL scaffold it first (`helpers/` + `test/workflows/AGENTS.md`) per the cross-actor journey rules, as a prerequisite task.

### 2.8 Documentation & Knowledge Gates

- **REQ-080 (Canonical Doc)**: WHEN knowledge propagation runs THEN `docs/parents/handshake-code-discovery.md` SHALL be created following the standard structure (Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents), covering: the code format & generation contract (linking `docs/auth/user-registration.md` §2), the discovery payload minimalism ruling (REQ-015..019) and mask algorithm, the governance-exclusion collapse rule, the null-not-error not-found precedent, the link-by-code forward contract for DEV1-014 (re-resolve server-side, never trust a stored id), the brute-force posture + D2 forward note, and the B.12 `linkable` signal semantics.
- **REQ-081 (Invariant Anchoring & Cross-Links)**: WHEN propagation runs THEN the doc SHALL bind to `docs/specs/state-machine-invariants.md` INV-P1..P4 (esp. INV-P1: discovery ≠ monitoring access) and to `docs/specs/open-decisions-and-gaps.md` A.2/A.3/B.12/B.13/B.14; a one-line cross-reference SHALL be appended to `docs/auth/user-registration.md`'s handshakes section AND `docs/workflows/04-*.md`'s related/implementation notes — NO renumbering or content edits of existing invariants; the invariant file gains, at most, a pointer line, and ONLY if one does not already exist.
- **REQ-082 (AGENTS.md Propagation)**: WHEN propagation runs THEN rule-only one-liners referencing the canonical doc SHALL land in: `backend/services/AGENTS.md` (handshake discovery service entry + minimal-payload rule), `backend/db/repo/AGENTS.md` (equality-lookup + no-prepared-statement note if applicable), `frontend/AGENTS.md` or `frontend/graphql/AGENTS.md` (embedded `keyFields:false` registration rule for `HandshakeCodeLookup`), and root `AGENTS.md` Important References. AGENTS entries contain rules/pointers only — no code, no plan meta.
- **REQ-083 (Outcome & Deferred Gate)**: WHEN the plan is considered complete THEN every task SHALL have an `outcome/<task-id>-outcome.md`, the Phase-1.5 `plan-review` outcome SHALL predate implementation, `grep -c "❌\|⚠️" ai/plans/dev1-013-student-handshake-code-generation/deferred-items.md` SHALL equal 0 EXCEPT pre-seeded D1..D3 which carry explicit owning tickets and non-blocking status per the ledger template, and the baseline comparison SHALL prove zero NEW errors.

### 2.9 Cross-Actor Workflow Scenarios (Journeys)

**Actor Table:**

| Actor | Role / Permission | CAN | CANNOT |
|---|---|---|---|
| **Student (Yusuf)** | `role=student`, owns `ctx.user.id`≡`students.id` | read own handshake code; share it out-of-band | read others' codes; change any code; search |
| **Parent (Fatima)** | `role=parent`, not yet linked | search by exact code; see masked identity + `linkable` | see full name/contacts/ids; see governed children; write links (DEV1-014) |
| **Second Parent / Stranger Parent** | `role=parent` | identical discovery rights on the code they possess | discover *which* parent is linked; bypass `linkable:false` (DEV1-014 also rejects) |
| **Teacher / Admin / Supervisor** | their roles | — (no surface) | read codes or search (FORBIDDEN) |
| **Anonymous** | none | — | everything (UNAUTHORIZED) |
| **System (registration)** | server-internal | generate unique codes atomically | regenerate/overwrite post-creation |

**Ordered Step List (maps 1:1 onto `test/workflows/parents/handshake-discovery.test.ts`):**

1. *System* → student registration completes → **state:** `students.handshakeCode` matches `^KSB-[0-9A-F]{8}$`, unique, non-null. Side effects: none new.
2. *Student* → `myHandshakeCode` → **state unchanged**; returns own code verbatim. Denial step 2b: *Parent* calling `myHandshakeCode` → `FORBIDDEN`; *anonymous* → `UNAUTHORIZED`.
3. *Parent* → search exact code → **state unchanged**; observes `maskedName` (≠ raw name) + `linkable: true`.
4. *Parent* → search garbled/lower-case-normalized variants → lower-case of a real code RESOLVES (normalization accepted); structurally invalid → `VALIDATION`; valid-but-missing → `null` (no error). *(Observer is the parent: outcome channel contents are contractually fixed.)*
5. *System/linker (fixture as DEV1-014 emulation)* → set `students.parentId` for the child directly via fixture write → *Second Parent* searches the same code → finds it with `linkable: false`; **no** indication of which parent is linked; the first parent's identity is never disclosed.
6. *Admin-domain state change (fixture)* → child user becomes `isDeleted` (or `isBlocked`/actively suspended, three fixtures) → *Parent* re-searches the SAME code → `null`, byte-identical to "never existed". *(Observer-perspective invariant: governance must never be detectable through discovery.)*
7. *Student* → self-view after governance exclusion → per the upstream fail-closed context rules the deleted/blocked caller cannot authenticate a request at all (denied at context, not at the resolver — recorded, not re-tested here).
8. *Teardown* → all fixture rows hard-deleted by tracked ids; subsequent suite runs polluted by zero residue.

**Cross-Actor EARS Criteria (observer-phrased):**

- **REQ-J1**: WHEN the system completes a student registration THEN a PARENT observing with that exact code SHALL discover exactly one child, and any parent observing with any other code SHALL discover `null`.
- **REQ-J2**: WHEN a child becomes already-linked THEN ANY searching parent SHALL observe `linkable: false` and SHALL NOT observe the incumbent parent's identity, the child's id, or any contact data.
- **REQ-J3**: WHEN a child enters a deleted/blocked/actively-suspended governance state THEN parents searching SHALL observe a result indistinguishable from a nonexistent code.
- **REQ-J4**: WHEN a student reads their own surface THEN they SHALL observe their own code and NEVER another student's, even under intentionally crafted cross-fixture ids in the harness.
- **REQ-J5**: WHEN any non-parent (student/teacher/admin/supervisor/anonymous) drives the discovery surface THEN they SHALL observe only `FORBIDDEN`/`UNAUTHORIZED` and zero payload bytes.

---

## 3. System Decisions & State Machine Invariants Alignment

### Decision References (`docs/specs/open-decisions-and-gaps.md`)

| Decision | Relevance to DEV1-013 | Binding Requirement |
|---|---|---|
| **A.3 (handshake_code unique, generated on creation)** | Core subject: generation exists (DEV1-002); this ticket locks uniqueness/non-null at the constraint layer and the format at the app layer. | REQ-010..012, REQ-072 |
| **A.2 (`students.parent_id` FK) + B.12 (one parent per student)** | The discovery payload's `linkable` flag is the read-side B.12 signal; the raw FK itself is never exposed. | REQ-018, REQ-019, REQ-J2 |
| **B.13 (parent links multiple children)** | Why a second parent's later linking is legitimate: the `linkable` gate is per-child, never per-parent. | REQ-018; doc REQ-080 |
| **B.14 (7-day link expiry)** | NOT implemented here (no link requests exist yet); discovery is stateless and emits no expirable record. Recorded so a reader doesn't mistake discovery for the pending-link state. | Non-goal 2; REQ-023 |
| **A.7 (governance on `users`) + Workflow 04 "deleted ⇒ parent loses access immediately"** | Discovery collapses governed children into `null` — the read-side twin of that ruling. | REQ-021, REQ-J3 |
| **INV-P1 (no monitoring without student confirmation)** | Discovery returns masked confirmation ONLY; it confers zero monitoring capability and zero PII beyond the sanctioned mask. | REQ-015..019, REQ-J1..J5 |
| **INV-P2 (read-only parent, MVP)** | The parent's only new capability is this read; no write surface is added. | REQ-031; non-goal 1 |
| **C.1 (parent role)** | The `role: [UserRole.Parent]` gate is grounded in the C.1 role's existence. | REQ-031 |

### State Machine & Lifecycle Invariants (`docs/specs/state-machine-invariants.md`)

| Invariant | Treatment |
|---|---|
| **INV-P1** | Enforced by structure: masked, ID-free payload; no `parent_id` is written; no monitoring data is joined. |
| **INV-P2** | Enforced: parent scope is read-only discovery only (REQ-031). |
| **INV-P3** (completion notifications) | Untouched — DEV3-010/DEV1-017 ownership; zero notification rows emitted (REQ-023). |
| **INV-P4 (link data model)** | Read-side honored: `parentId` powers `linkable` and is never exposed. |
| **INV-U1/U4/U5** | Governance exclusion reads governance state but NEVER reveals it; soft-delete semantics respected, no writes made. |
| **INV-B*/INV-W*** | Untouched by construction (zero balance/wallet/financial reads or writes). |

### Canonical Workflow Alignment (`docs/workflows/`)

- **Workflow 04 (Parent Supervision Handshake)** — DEV1-013 implements its §4.2 (parent search by code, limited info) and the *discovery* half of its sequence diagram; the request/expiry/confirm halves are DEV1-014/015 per B.14/INV-P1.
- **Workflow 05 (Admin Governance)** — no admin surface added; audit coupling N/A (no admin action exists in this slice).
- **Workflows 01/02/03** — untouched.

### Architectural & Foundational Standards

- **`docs/IDEMPOTENCY.md`** — N/A (no mutating writes; pure reads).
- **`docs/DATABASE_MIGRATIONS.md`** — zero schema drift; no push/migrate/reset invocation (REQ-045).
- **`docs/drizzle/prepared-statements.md` / `docs/graphql/dataloader-batching.md`** — equality read follows repo `queryDb(tx)` rules; no batching surface exists (single-code lookups); no list-typed loaders introduced.
- **`docs/graphql/error-handling-contract.md` + `domain-error-extensions-code.md`** — `VALIDATION`/`STUDENT_NOT_FOUND`/`FORBIDDEN`/`UNAUTHORIZED` semantics and localized masking discipline per REQ-050..052.
- **`docs/graphl api-gateway-and-routing.md` registration contract** — resolvers land in the sanctioned `query/<domain>/*.query.ts` placement with enum-free scalars only; no public-op additions (both queries are scoped).
- **`docs/auth/jwt-authentication-service.md` §5 (RBAC consumption)** — `role` scope usage with OR semantics, fail-closed evaluation, and the role↔identity boundary (`ctx.user.id` shared-PK ≡ `students.id`).

---

## 4. Cross-Layer Traceability Matrix

| Requirement ID | Decision Ref / Invariant | Backend Service | GraphQL Mutation/Query | Frontend View | Test Coverage |
|---|---|---|---|---|---|
| REQ-001 | Spec-driven Phase 0 protocol | Plan artifacts under `ai/plans/dev1-013-student-handshake-code-generation/` | — | — | `outcome/phase0-baseline-outcome.md`; plan-review gate |
| REQ-002 / REQ-051 | i18n namespace rules (`shared/locale/AGENTS.md`) | `getServerTranslations(locale, "errors")` service-side | `ctx.t("…")` in new resolvers | `useAppTranslation(Translation.<Ns>)` + `getTranslations(locale)` | `tsgo` MessageSchema parity gate; component translation-preload tests |
| REQ-003 | Canonical types (`backend/types/AGENTS.md`) | `backend/types/students/student.types.ts` (additive `Pick`/indexed-access shapes) | Pothos objects consume canonical types only | Codegen types only from `graphql.ts` | `review-types` wave; tsgo |
| REQ-004 | Existing-Codebase rule; DEV1-001/002 ownership | Verify-only: schema columns, generation path, scopes | — | — | Phase-1 guard checklist outcome |
| REQ-010 / REQ-040 | A.3; `docs/auth/user-registration.md` §2 | `RegistrationService` + `StudentRepository.createForRegistration` (verify-only, unchanged) | `registerUser` (existing, unchanged) | — | REQ-072 lock suite (`logic/auth` or `logic/students`) |
| REQ-011 / REQ-020 / REQ-054 | Shared-layer isolation (`shared/AGENTS.md`) | `shared/constants/handshake-code.constants.ts`, `shared/lib/mask-full-name.ts` (NEW, pure) | — | — | REQ-070 100% coverage; fuzz/RTL suites in REQ-073 |
| REQ-012 / REQ-041 | A.3 (DB ground truth) | Unique/NOT NULL constraints (existing) | — | — | REQ-072 `expectRepoError` constraint tests; collision race test |
| REQ-013 | Immutability by construction | Static scan: no `handshakeCode` writes outside creation | Schema grep: no mutation touching it | — | Static-assertion test in verification suite |
| REQ-014 | BOLA (own data) | `StudentHandshakeService.getMyHandshakeCode(ctx.user.id)` | `myHandshakeCode` | student card read | REQ-074 self-identity & role-matrix cells |
| REQ-015..019 | A.2/B.12/B.13; Workflow 04 §4.2; INV-P1 | `StudentHandshakeService.findByHandshakeCode` (JOIN users, governance filter, mask, linkable) | `findStudentByHandshakeCode(code)` → `HandshakeCodeLookup` | parent discovery flow | REQ-073/074 payload-shape + forbidden-key scans |
| REQ-016 | DEV2-004 null-precedence precedent | `null` return path (no error) | nullable top-level field | "no student found" state | REQ-073/074 null branches |
| REQ-017 | Minimal-disclosure ruling | `maskFullName` pure helper consumed by service | `maskedName` field | masked render | REQ-070/073 mask edge suite (RTL/emoji/single-part/empty) |
| REQ-018 / REQ-033 | B.12 read-signal; oracle hygiene | `linkable = parentId IS NULL` computed server-side | `linkable` field | already-linked state copy | REQ-073 already-linked fixture; REQ-J2 journey step 5 |
| REQ-019 | BOLA payload minimization | No ids in return shape | object without `id` | — | REQ-074 forbidden-key assertions; REQ-061 `keyFields:false` registration check |
| REQ-021 | A.7; WF-04 governance ruling | governance filter inside lookup query | (none — collapses to null) | — | REQ-073 three governance fixtures; REQ-J3 journey step 6 |
| REQ-022 / REQ-035 | Injection-surface N/A affirmation | parameterized equality only | input validation pre-DB | — | REQ-073 wildcard/unicode fuzz (`%`,`_`,`\`, RTL) |
| REQ-023 / REQ-025 | INV-P3 boundary; seeds rule | no side-effect writes; no seed edits | — | — | Scan + seed re-run green evidence |
| REQ-030..032 | BOLA/BFLA/BOPLA contracts | context-derived identity; role scopes; closed inputs | scopes on both ops | both surfaces role-gated server-side | REQ-074 full role matrix; REQ-J5; grep scans REQ-032 |
| REQ-034 | DEV2-002 rate-limit precedent | posture inherited; doc note D2 | — | — | Doc assertion; deferred ledger D2 status |
| REQ-042..045 | Repo rules; zero-drift policy | `queryDb(tx)` convention; `tx` optional-last | — | — | REQ-071/076; `git diff` schema-empty evidence |
| REQ-050..053 | DEV3-002 taxonomy + DomainError doc | `ValidationError`/`NotFoundError("STUDENT",…)`; `logger.logDomainError` | `extensions.code` assertions on every failure | code-branched rendering per error contract | REQ-073/074 code assertions; REQ-051 parity gate |
| REQ-060..063 | API-gateway registration contract; sharedDocuments rules | Pothos objects/query module + barrel wiring | SDL surface; documents in `sharedDocuments/students/` | — | Codegen diff committed; document-naming static checks |
| REQ-064..067 | `app/AGENTS.md` page-auth; MUI v9 rules | — | — | student card + `/parent/handshake` page | REQ-075 component suites (both locales); SSR guard tests |
| REQ-070..076 | Test-pyramid & quality-loop rules | `runInRollback` + `entity-setup.ts` + `expectRepoError` conventions | `setupTestServerLifecycle` + `testClient` | Happy DOM component tier | 100% coverage on new modules; sub-loop exit 0 per file |
| REQ-077 / REQ-J1..J5 | Cross-actor journey rules | `/dev/null` — real services called by journey harness | (journey uses services, not GraphQL) | — | `test/workflows/parents/handshake-discovery.test.ts` (+ scaffolded `test/workflows/AGENTS.md` if absent) |
| REQ-080..083 | Knowledge propagation protocol | `docs/parents/handshake-code-discovery.md`; cross-links; AGENTS one-liners | — | — | Doc-structure checklist; `grep -c "❌\|⚠️"` = 0 except D1–D3 (DEV1-014 / DEV2-002 / DEV3-019 owners); baseline delta = 0 |

**Traceability note for consumers:** DEV1-014 (link requests) MUST consume REQ-019's re-resolvable-by-code contract and REQ-018's `linkable` semantics (server-side re-check against `parentId` inside its own transaction — this ticket's read is advisory-at-its-isolation-level by design), DEV1-015 (confirm) consumes the masked-display contract for pending-request review UI, and DEV1-016/017 (portal/notifications) consume REQ-021's governance-collapse rule for consistency. These citations SHALL appear in those plans' own traceability matrices; violations are caught by their Phase-1.5 `@plan-review` gates.

---

**End of Specification — DEV1-013.** Ready for `ai/plans/dev1-013-student-handshake-code-generation/plan.md` (Phase 2 design), gated by `@plan-review` (Phase 1.5) before any implementation begins.
