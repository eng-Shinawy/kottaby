```markdown
# Trackable Implementation Tasks: DEV1-014 — Parent-Child Link Request Workflow (7-Day Expiry)

> **Plan directory (verbatim — every header, ledger path, outcome path, and self-reference in this document uses exactly this string):** `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day`
> **Specs of record:** `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/specs.md` (REQ-001..REQ-096)
> **Architecture of record:** `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/plan.md` (D1..D12)
> **Ticket:** DEV1-014 · Sprint 3 · 5 SP · Blocked by DEV1-013 (shipped)
> **Scope reality:** Backend (schema + types + repo + service + resolvers) — AND — Frontend (documents + one new student page + one parent-page section + nav + i18n namespace). ALL 8 phases are in scope; none are padded.

---

## Non-Negotiable Execution Protocol (applies to EVERY task)

1. **Pre-Execution outcome knowledge read:** BEFORE starting any task, read EVERY file under `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/outcome/` and `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/deferred-items.md`. Never repeat recorded mistakes; never re-litigate recorded decisions.
2. **Post-Edit verification loop:** after EVERY file created/modified, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` — exit code 0 REQUIRED before checkbox flipping. Iterate until clean.
3. **Test execution discipline:** test files run ONLY via `bun run test/scripts/run-test.ts <test-path>` (NEVER raw `bun test` — it skips `--env-file=.env.test`). Tier runners where applicable: `bun run test:db`, `bun run test:services`, `bun run test:graphql`, `bun run test:ui:components`.
4. **Semantic review self-review:** every task performs the full semantic checklist (atomicity, env-config, zero dead code, zero cross-layer imports, enums as VALUE imports, no `console.*`, no hardcoded strings/colors).
5. **Outcome documentation:** every completed task writes `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/outcome/<task-id>-outcome.md` (what shipped, deviations, verify anchors, next-task warnings).
6. **Checkbox tracking:** flip `[ ]` → `[x]` only after ALL sub-pipelines for that task pass (never pre-tick).
7. **Phase-1.5 gate:** `@plan-review` on specs+plan+tasks MUST pass (`outcome/plan-review-R1.md`, zero violations) BEFORE Phase 1 begins.
8. **Verification-first anchor rule:** any file/symbol/helper cited as existing that is NOT locatable in the bundle ⇒ downgrade the step to CREATE and record a ❌ ledger entry — never proceed on prose-only assumptions.

---

## Phase 0: Pre-Implementation Baseline

### 0.1 [x] Record baseline & initialize deferred-items ledger
**REQ:** REQ-001

- Run and capture counts:
  - `bun tsgo 2>&1 | tee /tmp/tsgo-baseline.txt` — record error count
  - `bun biome:check 2>&1 | tee /tmp/biome-baseline.txt` — record error count
  - `bun run scripts/lint-service.ts --json --id baseline` — record baseline totals
  - `git diff --name-only` — record the pre-existing modified-file set verbatim
- Create `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, seeded with the FOUR plan-provided resolved-pointers:
  - D1 cron expiry sweep + optional expiry reminder notifications (future cron-stream ticket) — resolved-pointer
  - D2 distinct `cancelled` link-status vocabulary (future product ticket) — resolved-pointer
  - D3 link revocation / `Unlinked` transition (future revoke ticket) — resolved-pointer
  - D4 partial-unique index Drizzle expressibility — resolved AT task 1.2 implementation time either way, outcomed both ways
- Write `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/outcome/0-baseline-outcome.md` with: counts, pre-existing modified files, ledger seed content.
- [x] 0.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/deferred-items.md --lifecycle duplicates` (exit 0)
- [x] 0.1.SR **Semantic Review:** baseline numbers are real captured stdout (not invented); ledger has ZERO open ❌/⚠️ items at seed time.
- [x] 0.1.IV **Instruction Verification:** validate against `.agents/instructions/tests.instructions.md` (baseline capture discipline) — the ONLY instruction files are `.agents/instructions/{frontend,backend,tests}.instructions.md`.

### 0.2 [x] Prerequisite & substrate verification (reuse-never-fork guard)
**REQ:** REQ-004

Verify each anchor is REAL in the bundled tree (locate it; cite line). ANY miss ⇒ ❌ ledger entry AND dependent tasks block.

- [x] `backend/services/notifications/notification-engine.service.ts:288-340` — `emitForUser` (caller-tx, returns receipt, no publish) + `publishReceipts` composition (at ~340+)
- [x] `backend/services/students/student-handshake.helpers.ts:33-60` — `isGovernanceExcludedFromDiscovery(row, now)`
- [x] `backend/db/repo/students/student.repository.ts:78-120` — `findDiscoveryByHandshakeCode` (join+payload shape)
- [x] `backend/db/repo/users/user.repository.ts:200-250` — `findLocalesByIds`; `shared/locale/AppLocale.ts:10` — `defaultLocale = "ar"`
- [x] `backend/lib/db/with-transaction` — `withTransaction(outerTx, fn)` (import anchored at `backend/services/admin/user-management.service.ts:13`)
- [x] `backend/lib/errors.ts:24-30` (`NotFoundError` entity form), `:90-130` (`ConflictError` class with overloads — VERIFIED before assigning codes)
- [x] `backend/enum/shared/link-status.enum.ts:1-6` — `LinkStatus` exists, NO `isLinkStatus` guard; `backend/enum/teachers/applicant-status.enum.ts:7-9` — `isApplicantStatus` precedent
- [x] `backend/db/schema/enums.ts:54` — `linkStatus` pgEnum inventory `["pending","confirmed","rejected","expired"]` — FROZEN, this ticket is its first consumer
- [x] Journey harness DOES NOT EXIST: `test/workflows/AGENTS.md` exists but `test/workflows/helpers/` directory and helpers (`TrackedFixtures`, `provisionParentActor`, `provisionStudentActor`, `SpiedFanoutTransport`) do NOT exist — the AGENTS.md says "Status: The shared harness is scaffolded" but this is aspirational. Task 2.1 must CREATE the harness, not reuse it. Referenced test files (`fanout-transport.test.ts`, `notification-engine.emit.test.ts`) also do not exist.
- [x] `test/helpers/skip-when-pglite.ts:1-5` — `isPgliteProvider`
- [x] `shared/lib/mask-full-name.ts` — `maskFullName` signature (referenced at `backend/services/students/student-handshake.service.ts:7`; VERIFY the export name + signature in the bundle before fronting it in 4.x types)
- [x] `shared/locale/client/use-app-translation.ts:1-12` — `useAppTranslation` OVERLOAD contract: `useAppTranslation(): Translations` + `useAppTranslation<TLabels>(handle: NamespaceHandle<TLabels>): TLabels`; `shared/locale/server.ts:12-14` (`getTranslations` 1-arg); `shared/locale/server-graphql.ts:2-4` (`getServerTranslations` 1-arg)
- [x] `frontend/lib/auth/withPageAuth.ts:15-30` — `{ roles, redirectTo }` signature; `frontend/lib/auth/roleDashboardRoute.ts:9-22` — `roleDashboardPath(ctx.role)`
- [x] Frontend prose-only UI verification planned at implementation time (NOT now, no code writes yet): `frontend/views/parent/handshake/HandshakeDiscoveryContainer.tsx`, `app/(dashboard)/parent/handshake/page.tsx`, `test/ui/AGENTS.md` harness (`TestWrapper`, translation preload) — record provisional verdicts in the ledger; final verify happens inside tasks 4.2/4.3.
- [x] 0.2.QL **Quality Loop:** outcomes written; ledger up-to-date; `bun run scripts/health/sub-loop.ts ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/outcome/0-prereq-outcome.md --lifecycle duplicates` (exit 0)
- [x] 0.2.SR **Semantic Review:** every claimed EXISTING artifact carries a live `path:line` anchor produced by this task; any prose-only artifact is DOWNGRADED to CREATE in the dependent task.
- [x] 0.2.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md`.

### 0.3 [x] Phase-1.5 `@plan-review` gate
**REQ:** REQ-083

- Invoke the plan-review agent on `specs.md` + `plan.md` + `tasks.md` of `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/`.
- Capture the review verdict to `outcome/plan-review-R1.md`. HARD GATE: zero violations before Phase 1 starts; otherwise fix the plan first.
- [x] 0.3.QL **Quality Loop:** gate outcome file present & complete
- [x] 0.3.SR **Semantic Review:** every violation either fixed in plan/tasks or downgraded to a recorded ledger entry — NO silent ignores.
- [x] 0.3.IV **Instruction Verification:** the review checklist itself came from `.agents/instructions/{backend,frontend}.instructions.md`.

---

## Phase 1: Types, Enums & Database Schema

### 1.1 [x] i18n increments — errors flat keys, notification copy slots, dashboard nav label, NEW `parentLink` namespace (full registration)
**REQ:** REQ-002, REQ-051, REQ-052, REQ-066, REQ-075 · `shared/AGENTS.md` checklist is the registration reference

- **Errors namespace (FLAT, camelCase-mirroring codes — precedent `handshakeCodeInvalid` at `shared/locale/en/errors/index.ts:48`):**
  - `shared/locale/types/errors/index.ts` — ADD FLAT keys to `ErrorsLabels`: `parentLinkTargetAlreadyLinked`, `parentLinkAlreadyPending`, `parentLinkRequestExpired`, `parentLinkRequestAlreadyResolved`, `parentLinkRequestNotFound` (NO new nested groupings)
  - `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts` — both leaves, Arabic-script in ar
- **Notifications namespace (SIX new non-`type*` slots):**
  - `shared/locale/types/notifications/index.ts` (`NotificationsLabels`): `eventParentLinkRequestTitle`, `eventParentLinkRequestBody: (parentName: string) => string`, `eventParentLinkAcceptedTitle`, `eventParentLinkAcceptedBody: (studentName: string) => string`, `eventParentLinkRejectedTitle`, `eventParentLinkRejectedBody: (studentName: string) => string`
  - `shared/locale/en/notifications/index.ts` + `shared/locale/ar/notifications/index.ts` — both leaves; Arabic Arabic-script pins in functions too
  - `shared/locale/notifications-namespace.parity.test.ts:8-35` — SAME changeset: `MANDATED_KEYS` 26 → 32; function-slot inventory 4 → 7; the "exactly seven `type*` keys" pin stays GREEN UNCHANGED
- **Dashboard nav label:** `shared/locale/types/dashboard/index.ts` + `shared/locale/en/dashboard/index.ts` + `shared/locale/ar/dashboard/index.ts` — ADD `linkRequests: string`. Owner: Dashboard ONLY (the navItems ownership matrix at `navItems.test.ts:19-29` stays green).
- **NEW `parentLink` namespace end-to-end:**
  - CREATE `shared/locale/types/parentLink/index.ts` — `ParentLinkLabels` with EXACTLY the plan §5.6 inventory (`studentPageTitle`, `studentPageSubtitle`, `incomingEmptyTitle`, `incomingEmptyBody`, `fromLabel`, `sentAtLabel`, `expiresLine: (date: string) => string`, `statusPending`, `statusConfirmed`, `statusRejected`, `statusExpired`, `confirmAction`, `rejectAction`, `confirmDialogTitle`, `confirmDialogBody: (parentName: string) => string`, `rejectDialogTitle`, `rejectDialogBody: (parentName: string) => string`, `confirmSuccessToast`, `rejectSuccessToast`, `cancelAction`, `cancelDialogTitle`, `cancelDialogBody`, `cancelSuccessToast`, `outgoingTitle`, `outgoingEmptyTitle`, `outgoingEmptyBody`, `sendRequestAction`, `sendRequestSuccessToast`, `requestPendingNotice`, `sendUnavailableNotice`)
  - CREATE `shared/locale/en/parentLink/index.ts` + `shared/locale/ar/parentLink/index.ts` (Arabic-script in EVERY ar slot incl. function outputs)
  - CREATE `shared/locale/namespaces/parentLink/parentLink.namespace.ts` (+ `index.ts`) — `export const ParentLink = defineNamespace<ParentLinkLabels>("parentLink.parentLink", t => t.parentLinkTranslations)`
  - UPDATE `shared/locale/namespaces/index.ts` (registry + `export *`)
  - UPDATE `shared/locale/types/message.ts:12-24` (`Translations` gains `parentLinkTranslations: ParentLinkLabels`) + BOTH `shared/locale/en/messages.ts` and `shared/locale/ar/messages.ts` bundles
  - CREATE `shared/locale/parentLink-namespace.parity.test.ts` mirroring `notifications-namespace.parity.test.ts` (key-set identity, non-empty, Arabic-script pins, function-slot parity, registry/bundle pins)
- **Files must NEVER import `@/backend/**`, `@/frontend/**`, `@/app/**` (layer isolation, hard rule).**
- [x] 1.1.QL **Quality Loop:** for EACH of the above paths: `bun run scripts/health/sub-loop.ts <path> --lifecycle duplicates` (exit 0)
- [x] 1.1.TE **Test Engineering:**
  - Run `bun run test/scripts/run-test.ts shared/locale/notifications-namespace.parity.test.ts` — GREEN with 32 keys + 7 function slots
  - Run `bun run test/scripts/run-test.ts shared/locale/parentLink-namespace.parity.test.ts` — GREEN
  - Run `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` — unchanged shape, GREEN
  - Run `bun run test/scripts/run-test.ts frontend/views/dashboard/navItems.test.ts` — still green (no route added yet — see task 4.4; this task only adds the LABEL; matrix ownership stays valid)
- [x] 1.1.SEC **Security & Tenancy Audit:** no user input reaches these slots unsanitized (copy functions receive already-assembled names only); zero secrets/PII in labels.
- [x] 1.1.SR **Semantic Review:** FLAT-key discipline kept; no `Translation` enum invented; no `next-intl` import; all copy slots used by specs §2.5/§5 are present (spec-traceable).
- [x] 1.1.IV **Instruction Verification:** validate against `shared/AGENTS.md` checklist + `.agents/instructions/backend.instructions.md` (locale discipline lives in backend instructions).

### 1.2 [x] NEW table `parent_link_requests` + parents barrel + delivery via `bun run db push` (+ ledger decision on Drizzle expressibility)
**REQ:** REQ-010, REQ-045, REQ-046 · plan D4

- CREATE `backend/db/schema/parents/parent-link-requests.ts` EXACTLY per plan §2.2:
  - `id` identity PK; `parentId integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT`; `studentId integer NOT NULL REFERENCES students(id) ON DELETE RESTRICT`
  - `status linkStatus("status").notNull().default("pending")` — REUSING the existing pgEnum, ZERO enum edits
  - `createdAt timestamp NOT NULL DEFAULT now()`; `expiresAt timestamp NOT NULL` (NEVER default-computed — application-written `+7d`); `respondedAt timestamp NULL`
  - Indexes: `(parent_id)`, `(student_id)`, PARTIAL UNIQUE `(parent_id, student_id) WHERE status='pending'`
- UPDATE `backend/db/schema/parents/index.ts` — ONE line: `export * from "./parent-link-requests";`
- Delivery:
  - FIRST attempt: Drizzle-native partial unique (`unique(...).on(...).where(sql`${t.status} = 'pending'`)`) — verify it compiles
  - Run `bun run db push` per `docs/DATABASE_MIGRATIONS.md`
  - IF the partial-unique `.where()` proves unexpressible in the bundled Drizzle version ⇒ fallback = ONE ADDITIVE custom SQL file under `backend/db/migration/` + new drizzle folder; RECORD the choice + reason in the ledger (D4) and in `outcome/1.2-outcome.md`
- VERIFY drift gate: `git diff backend/db/schema/**` shows EXACTLY the new table file + the one-line barrel edit — `enums.ts`/`students.ts`/`users.ts` untouched
- [x] 1.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/schema/parents/parent-link-requests.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/db/schema/parents/index.ts --lifecycle duplicates` (exit 0)
- [x] 1.2.TE **Test Engineering:** schema smoke test — assert table + 3 indexes + partial-unique WHERE predicate visible in `db push` dry-run / introspection output; assert table importable from barrel without circular-deps warnings (`bun tsgo` stays at baseline)
- [x] 1.2.SEC **Security & Tenancy Audit:** FKs are both RESTRICT (append-and-transition-only history rows); NO cascade semantics were added; the partial unique is the duplicate-pending final arbiter (D4)
- [x] 1.2.SR **Semantic Review:** zero enum inventory edits; zero edits to `enums.ts`/`students.ts`/`users.ts`; the table file is ADDITIVE-ONLY
- [x] 1.2.IV **Instruction Verification:** validate against `docs/DATABASE_MIGRATIONS.md` + `.agents/instructions/backend.instructions.md`

### 1.3 [x] Shared constant + enum guard (additive, zero behavior change elsewhere)
**REQ:** REQ-003, REQ-015, REQ-044 · plan §2.4/§2.5

- CREATE `shared/constants/parent-link-request.constants.ts`:
  ```typescript
  export const PARENT_LINK_REQUEST_TTL_DAYS = 7;
  export const PARENT_LINK_REQUEST_MS = PARENT_LINK_REQUEST_TTL_DAYS * 86_400_000;
  ```
  ZERO `@/backend/**` imports. Barrel: `shared/constants/index.ts` (currently 3 lines) gains one line.
- UPDATE `backend/enum/shared/link-status.enum.ts` — APPEND the guard (mirroring `isApplicantStatus` at `backend/enum/teachers/applicant-status.enum.ts:7-9`):
  ```typescript
  export function isLinkStatus(value: unknown): value is LinkStatus {
    return typeof value === "string" && (Object.values(LinkStatus) as string[]).includes(value);
  }
  ```
- [x] 1.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts shared/constants/parent-link-request.constants.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/enum/shared/link-status.enum.ts --lifecycle duplicates` (exit 0)
- [x] 1.3.TE **Test Engineering:** compact sibling guard test `backend/enum/shared/link-status.enum.test.ts` mirroring `applicant-status.enum.test.ts` — accepts all four enum members, rejects `"Pending"` case-flipped/whitespace/empty/number/object/null/undefined; boundary fuzz. Run `bun run test/scripts/run-test.ts backend/enum/shared/link-status.enum.test.ts`
- [x] 1.3.SEC **Security & Tenancy Audit:** guard is pure — no I/O, no global state; fail-closed by construction
- [x] 1.3.SR **Semantic Review:** enum imported as VALUE; shared/constants carries zero backend imports; TTL semantics match strict-`>` predicate design (REQ-015)
- [x] 1.3.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md`

### 1.4 [x] Canonical types — link-request types + students link-target row + barrels
**REQ:** REQ-003 · plan §2.3

- CREATE `backend/types/parents/parent-link-request.types.ts`:
  - `ParentLinkRequestSelectType = typeof parentLinkRequests.$inferSelect`
  - `ParentLinkRequestInsertType = typeof parentLinkRequests.$inferInsert`
  - `OutgoingParentLinkRequestReturnType { id, status: LinkStatus, studentMaskedName, createdAt, expiresAt, respondedAt }` (readonly)
  - `IncomingParentLinkRequestReturnType { id, status: LinkStatus, parentFullName, createdAt, expiresAt, respondedAt }` (readonly)
- UPDATE `backend/types/parents/index.ts` — `export * from "./parent-link-request.types";` (prefix shape at `backend/types/parents/index.ts:1`)
- UPDATE `backend/types/students/student.types.ts` — ADD `StudentLinkTargetRowType { studentId, parentId: number|null, fullName, isDeleted, isBlocked, suspended, suspendedAt, suspendedPeriodDays }` (server-internal — NEVER a GraphQL payload)
- NO service-layer `.types.ts` files appear anywhere (hard rule)
- [x] 1.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/parents/parent-link-request.types.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/types/parents/index.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/types/students/student.types.ts --lifecycle duplicates` (exit 0)
- [x] 1.4.TE **Test Engineering:** `bun tsgo` re-run — error count == 0.1 baseline (no new errors)
- [x] 1.4.SEC **Security & Tenancy Audit:** types carry ONLY the fields the GraphQL surface promises (BOPLA at the return-type boundary); `StudentLinkTargetRowType` carries governance columns needed for REQ-031-style reads but is never serialized over the wire
- [x] 1.4.SR **Semantic Review:** no local resolver types planned; all types centralized; readonly discipline on return types
- [x] 1.4.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md`

---

## Phase 2: Repositories & Backend Services

### 2.1 [x] Write parent-link-request journey test — TEST-FIRST
**REQ:** REQ-076, REQ-090..REQ-096, REQ-046 (teardown order) · specs §2.9 · plan §4.4

- Create `test/workflows/parents/parent-link-request.journey.test.ts` — one file covering the three journeys (A/B/C)
- CREATE the journey harness: `test/workflows/helpers/` with `TrackedFixtures`, `provisionParentActor`, `provisionStudentActor`, `SpiedFanoutTransport` (the AGENTS.md says "scaffolded" but it's aspirational — must be built from scratch)
- Provision the actor cast (specs §2.9): Parent A, Parent B, Student S, Governed Student G, Already-Linked Student L (pre-linked to A)
- Steps as sequential service calls with `actorUserId`. REQ-011 REQ-016-style assertions per plan §4.4 visibility matrix. Assert cross-actor visibility AND denial paths honestly (REAL permission/group membership; NEVER monkey-patched)
- Committed fixtures in ONE `beforeAll` `db.transaction`; tracked hard-delete in `afterAll` with deletion ordering: `parent_link_requests` FIRST, then `students`, then `users` (REQ-046 — reverse-registration per `test/workflows/AGENTS.md` rule 2); mandatory ZERO-residue re-probes after teardown
- Spy `SpiedFanoutTransport` at the `options.transport` seam; NEVER hit real email/SMS/push. Publish only via post-commit `publishReceipts`.
- Unique prefixing: `jrn_plink_<uuid8>` on all entity identity fields
- `runInRollback` FORBIDDEN here (services spawn their own transactions)
- Assertions include (REQ-090..096): EXACTLY ONE publish per notify-boundary; null-collapse byte-equality (miss ≡ governed); REQ-091 sibling-expiry visibility by BOTH parents; REQ-092 zero-notify on already-linked; REQ-093 constant-shape `PARENT_LINK_REQUEST_NOT_FOUND` for foreign-id and nonexistent-id from BOTH directions; REQ-094 silent expiry + persisted `expired` row; REQ-095 duplicate-pending count=1; REQ-096 zero rows after collapse
- Chaos race (REQ-042/043 wiring into the journey or a sibling focused file — if you keep the journey file clean, the race proofs land in the chaos tier at 5.2; the journey covers the SEQUENTIAL second-confirm-reject): sequential second-confirm AFTER a committed first-confirm ⇒ `PARENT_LINK_TARGET_ALREADY_LINKED`; sibling pendings of the winner's student ALL `expired`
- Initial state: RED (no service surface yet) — this is the expected TEST-FIRST posture; it TURNS GREEN at task 2.3/3.x completion
- [x] 2.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts test/workflows/parents/parent-link-request.journey.test.ts --lifecycle duplicates` (exit 0)
- [x] 2.1.TE **Test Engineering:** `bun run test/scripts/run-test.ts test/workflows/parents/parent-link-request.journey.test.ts` — RED against service-surface absence at this stage (correct); every later task that touches the service MUST keep it runnable
- [x] 2.1.SEC **Security & Tenancy Audit:** denials exercised through REAL role + governance resolution; zero notification side effects on denials; fingerprint logging free of codes/names/emails
- [x] 2.1.SR **Semantic Review:** no monkey-patching; every actor call carries an honest `actorUserId`; per-step assertions exist for BOTH actor visibility and cross-actor invariance
- [x] 2.1.IV **Instruction Verification:** `test/workflows/AGENTS.md` (to be created with harness rules) + `docs/testing/workflow-journey-tests.md` + `.agents/instructions/tests.instructions.md`
- _Requirements: REQ-076, REQ-090..REQ-096, REQ-046_

### 2.2 [x] Implement `ParentLinkRequestRepository` + additive `StudentRepository` methods + register barrels
**REQ:** REQ-010 (delivery read), REQ-032, REQ-033, REQ-037, REQ-040 (tx propagation), REQ-041 (guarded-only), REQ-070 (repo tier) · plan §4.1

- CREATE `backend/db/repo/parents/parent-link-request.repository.ts` with EXACTLY these methods (`tx` LAST, `tx ?? db` executor discipline):
  - `create({ parentId, studentId, expiresAt }, tx: DBTransaction): Promise<ParentLinkRequestSelectType>` — INSERT … RETURNING (status from schema default)
  - `findById(id, tx?: DBQueryExecutor): Promise<… | null>`
  - `findPendingByPair(parentId, studentId, tx?: DBQueryExecutor): Promise<… | null>`
  - `respondToPendingForStudent(requestId, studentId, target: LinkStatus.Confirmed | LinkStatus.Rejected, now: Date, tx): Promise<… | null>` — ONE guarded `UPDATE … SET status, responded_at WHERE id AND student_id AND status='pending' AND expires_at > now RETURNING *`
  - `cancelPendingForParent(requestId, parentId, now, tx): Promise<… | null>` — guarded with `SET status='rejected', responded_at=now` (withdrawal fold — REQ-018/D9)
  - `markExpiredIfPending(requestId, tx): Promise<void>` — idempotent by predicate
  - `expireSiblingPendingsForStudent(studentId, winnerRequestId, tx): Promise<number>` — `WHERE student_id AND status='pending' AND id <> winner`
  - `listOutgoingForParent(parentId, tx?): Promise<OutgoingRow[]>` — join `users` for `fullName`; `ORDER BY created_at DESC, id DESC LIMIT 50`
  - `listIncomingForStudent(studentId, tx?): Promise<IncomingRow[]>` — join `users` on `parentId`; same ordering/cap
  - `findOutgoingRowById(requestId, tx?)` / `findIncomingRowById(requestId, tx?)` — single-row join reads for success-path payloads
  - Repo-local exported interfaces `OutgoingParentLinkRequestRow` / `IncomingParentLinkRequestRow` mirror the `AdminUserDirectoryRow` precedent at `backend/db/repo/admin/admin-user.repository.ts:41-61`
- UPDATE `backend/db/repo/parents/index.ts` — one new re-export line
- UPDATE `backend/db/repo/students/student.repository.ts` — ADD, at a location consistent with sibling methods (do NOT touch existing methods):
  - `findLinkTargetByHandshakeCode(code, tx?): Promise<StudentLinkTargetRowType | null>` — parameterized equality ONLY (zero LIKE/ILIKE); join to `users` for governance columns + `fullName`
  - `linkParentIfUnlinked(studentId, parentId, tx): Promise<StudentSelectType | null>` — ONE guarded `UPDATE students SET parent_id = $2, updated_at = now() WHERE id = $1 AND parent_id IS NULL RETURNING *` — THE only production writer of a non-null `students.parent_id`
- NO `SELECT FOR UPDATE`, NO advisory locks, NO read-then-write patterns (D2)
- [x] 2.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/repo/parents/parent-link-request.repository.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/db/repo/parents/index.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/db/repo/students/student.repository.ts --lifecycle duplicates` (exit 0)
- [x] 2.2.TE **Test Engineering (4-Tier via repo suite; REQ-070):**
  - CREATE `backend/db/repo/parents/parent-link-request.repository.test.ts` + ADDITIVE blocks in `backend/db/repo/students/student.repository.test.ts`
  - Tier 1: create/findById/findPendingByPair round-trips; guarded claims ALL zero-row classifier arms (nonexistent id, wrong owner, already-resolved, expired-at-write instant); sibling expiry counts + exclusion of winner; cancel scopes; lists ordering/deterministic tie-break + LIMIT 50; join payloads carry the counterpart name column
  - Tier 2: boundary — claim exactly at `expiresAt` (`expires_at > now` FALSE) returns NULL; strict-`>` parity at ±1ms
  - Tier 3: partial-unique insert conflict assertion shared with the service tier (the service owns the final mapping, repo only asserts the raw DB error surfaces 23505); concurrent inserts skip-gated under pglite via `isPgliteProvider`
  - Tier 4: `runInRollback` everywhere; `tx` propagation proven (every method callable under outer `tx` and with default `db`); `expectRepoError` try/catch — NEVER `rejects.toThrow`; fixtures only via `entity-setup.ts` helpers (verify helper signatures from the bundle FIRST); zero raw SQL construction beyond parameterized equality
  - Run: `bun run test/scripts/run-test.ts backend/db/repo/parents/parent-link-request.repository.test.ts` and the repo suite tier via `bun run test:db`
- [x] 2.2.SEC **Security & Tenancy Audit:**
  - Ownership predicates inlined into UPDATE WHERE-clauses (BOLA at the statement level)
  - BOPLA: insert payload = EXACTLY `{ parentId, studentId, expiresAt }` field-by-field; NO `{ ...input }` anywhere
  - No LIKE/ILIKE in ANY new method (REQ-037)
  - `linkParentIfUnlinked` is the ONLY writer pinned by the upcoming static scan (task 5.3)
- [x] 2.2.SR **Semantic Review:** every state transition is a single guarded UPDATE + RETURNING; zero TOCTOU; zero dead code; enum used as VALUE import; no `console.*`
- [x] 2.2.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` + `backend/db/repo/AGENTS.md` (reader path for repo rules)
- _Requirements: REQ-010, REQ-032, REQ-033, REQ-037, REQ-040, REQ-041, REQ-070_

### 2.3 [x] Implement `ParentLinkRequestService` (create/respond/cancel/lists) — engine composition + fail-closed actor re-check
**REQ:** REQ-011..REQ-024, REQ-031..REQ-035, REQ-040..REQ-044, REQ-050, REQ-053, REQ-054, REQ-071· plan §4.2/§4.3

- CREATE `backend/services/parents/parent-link-request.service.ts`, CREATE `backend/services/parents/index.ts`, UPDATE `backend/services/index.ts` (one re-export line)
- Namespace-export shape (`ParentLinkRequestService.{requestLink, respondToLinkRequest, cancelLinkRequest, listMyOutgoing, listMyIncoming}`) with signatures EXACTLY per plan §4.2
- Service internals:
  - **Module-private actor re-check (REQ-031)** — one local function used by every mutation + read path: fresh `UserRepository.findById(actorId, tx)`; missing/id≤0 → `UnauthorizedError(t.unauthorized)`; role mismatch → `ForbiddenError(t.forbidden)`; `isDeleted || isBlocked || suspended` → `ForbiddenError(t.forbidden)` (constant copy). EACH denial = ONE `logDomainError` `{ code, entity: "users", entityId, locale }`, ZERO writes, ZERO notifications (JR-C-1 parity)
  - **`requestLink`** per plan §4.2 ordered pipeline: normalize+validate code PRE-DB (`ValidationError(t.handshakeCodeInvalid)` — EXISTING key, verified at `shared/locale/en/errors/index.ts:48`) → actor re-check (parent) → ONE `withTransaction(outerTx, …)`: ONE captured `now`; `findLinkTargetByHandshakeCode`; null/governance-excluded ⇒ return `null` (REQ-012); `parentId !== null` ⇒ `ConflictError("PARENT_LINK_TARGET_ALREADY_LINKED", t.parentLinkTargetAlreadyLinked)`; `findPendingByPair` ⇒ `ConflictError("PARENT_LINK_ALREADY_PENDING", …)`; `create` wrapped in 23505 cause-chain traversal via `isUniqueViolation` (`backend/services/shared/user-provisioning.helpers.ts:29-44`) mapping to SAME conflict; resolve recipient locale via `findLocalesByIds` + `defaultLocale` fallback; in-tx `NotificationEngine.emitForUser({ userId: studentId, type: NotificationType.ParentLinkRequest, title, body, relatedEntityType: "parent_link_request", relatedEntityId: created.id }, recipientLocale, tx, options)`; own-commit only → `NotificationEngine.publishReceipts(...)`; return outgoing-mapped payload with `maskFullName(target.fullName)`
  - **`respondToLinkRequest`** per plan §4.2: actor re-check (student) → ONE tx → `respondToPendingForStudent` guarded claim; null → classifier via `findById` (nonexistent/foreign ⇒ constant `NotFoundError("PARENT_LINK_REQUEST", t.parentLinkRequestNotFound)`; non-pending ⇒ `..._ALREADY_RESOLVED`; pending-but-dead ⇒ `markExpiredIfPending` + `..._EXPIRED`); accept=true: `linkParentIfUnlinked` guarded link write (zero rows ⇒ `PARENT_LINK_TARGET_ALREADY_LINKED` — the WHOLE tx rolls back; NO ghost confirmation), then `expireSiblingPendingsForStudent`, then in-tx `emitForUser` to the parent in parent's persisted locale (accepted copy + student's name), post-commit publish; accept=false: in-tx `emitForUser` (rejected copy) + NO students write + NO sibling expiry
  - **`cancelLinkRequest`**: actor re-check (parent) → tx → `cancelPendingForParent`; zero rows ⇒ SAME classifier; success ⇒ ZERO notifications (silent withdrawal); return outgoing-shaped payload via `findOutgoingRowById`
  - **`listMyOutgoing` / `listMyIncoming`**: relaxed-read actor re-check (self-scope honesty — self-scoped by the VERIFIED actorId regardless of request payload) → repo list → per-row computed render: `status === LinkStatus.Pending && expiresAt <= now` ⇒ surface `LinkStatus.Expired` WITHOUT writing (read purity, REQ-015); read-mapping goes through `isLinkStatus` (fail-closed on corrupt stored status)
  - Copy composition: via `getServerTranslations(recipientLocale).notificationsTranslations.eventParentLink*` — recipient-locale at the EMITTER (engine §3.3, DEV3-018 D6)
  - Log hygiene: `logDomainError` contexts EXACTLY `{ code, entity: "parent_link_requests" | "students" | "users", entityId?, locale }` — NEVER codes, NEVER names, NEVER emails, NEVER the submitted handshake code (R8 carried forward); happy path emits NOTHING (REQ-054)
- [x] 2.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/services/parents/parent-link-request.service.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/services/parents/index.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/services/index.ts --lifecycle duplicates` (exit 0)
- [x] 2.3.TE **Test Engineering (4-Tier, `backend/services/parents/parent-link-request.service.test.ts`; REQ-071):**
  - Tier 1 branch/stmt: every branch of request/respond/cancel/lists; recipient-locale resolution incl. `defaultLocale` fallback; publish discriminant (own-commit vs caller-tx — caller-tx NEVER publishes)
  - Tier 2 boundary: `expiresAt` at exactly now, now−1ms, now+1ms; strict-`>` predicate proven; one-captured-`now` deterministic within a single call
  - Tier 3 chaos: forced repo failure unmasks; post-claim injected failure rolls back the ENTIRE tx (zero residual rows across `parent_link_requests`/`students`/`notifications`)
  - Tier 4 security: `runInRollback` throughout; ZERO write/notification row probes on EVERY denial arm; log-pressure happy-path silence; service-layer governed-actor denial with a PRE-ISSUED token simulation (actor row flipped governed between issue and call)
  - Counts pinned: per REQ-053 each denial writes ZERO rows across `parent_link_requests`/`students`/`notifications`/`audit_logs`
  - Run: `bun run test/scripts/run-test.ts backend/services/parents/parent-link-request.service.test.ts` AND `bun run test:services`
  - Journey 2.1 turns GREEN at the end of this task (confirm via `bun run test/scripts/run-test.ts test/workflows/parents/parent-link-request.journey.test.ts`)
- [x] 2.3.SEC **Security & Tenancy Audit:**
  - REQ-031 actor re-check runs FIRST on every mutation/read; ZERO BYPASS PATHS
  - REQ-034 oracle matrix enforced: null-collapse equality; constant-shape NOT_FOUND; honest conflict codes; timing parity assertions where materially meaningful
  - BOPLA: every DB payload field-by-field; `relatedEntityType: "parent_link_request"` literal; `relatedEntityId` is the created request id
  - NO LIKE/ILIKE; capability-by-code targeting (the student id never crosses the wire)
- [x] 2.3.SR **Semantic Review:** `withTransaction` owns every mutation; guarded updates only; single-writer notifications (engine); single-writer `students.parent_id` (the new repo method); no dead code; no cross-layer imports (`services/**` importing from `@/backend/db/**` only via repos)
- [x] 2.3.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` + `backend/services/AGENTS.md` (the service-layer rules; repo rule additions come in Phase 7 docs)
- _Requirements: REQ-011..REQ-024, REQ-031..REQ-035, REQ-040..REQ-044, REQ-050, REQ-053, REQ-054, REQ-071_

### 2.4 [x] **Phase 2.M Mid-Point Review Gate**
**REQ:** REQ-083 protocol · architectural checkpoint before the GraphQL surface

- Re-read ALL outcomes under `outcome/`; confirm journey (2.1) is GREEN; repo tier (2.2.TE) 100% green; service tier (2.3.TE) green
- Sanity assertions executed mid-flight:
  - `git diff backend/db/schema/**` shows EXACTLY the new table + barrel line (REQ-045 pre-check)
  - `grep -r "parentId\s*:\s*[^n]" backend/services backend/db/repo --include="*.ts" | grep -v test | grep -v "entity-setup"` produces NO non-null `parent_id` assignment outside the single new repo method (pre-cursor to the Phase 5 static pin)
  - `bun tsgo` count == 0.1 baseline; `bun biome:check` count == 0.1 baseline
- Write `outcome/2.M-midpoint-outcome.md` — list deviations, ledger deltas, and Phase-3 readiness
- HARD GATE: any ❌ in the ledger BLOCKS Phase 3 until resolved or resolved-pointer recorded.
- [x] 2.4.QL **Quality Loop:** outcome file present, ledger consistent
- [x] 2.4.SR **Semantic Review:** journey green because the SERVICE surface is correct — not because tests were weakened (diff-review the journey since 2.1 for scope creep)
- [x] 2.4.IV **Instruction Verification:** `.agents/instructions/{backend,tests}.instructions.md`

---

## Phase 3: GraphQL Resolvers & API Handlers

### 3.1 [x] Register `LinkStatus` Pothos enum + CREATE Pothos objects for both request shapes
**REQ:** REQ-060, REQ-011-scalar rules · plan §3.2

- UPDATE `backend/graphql/pothos/shared/enum.pothos.ts` — REGISTER ONCE, enum-OBJECT form ONLY:
  ```typescript
  export const LinkStatusPothosEnum = gqlSchemaBuilder.enumType(LinkStatus, { name: "LinkStatus" });
  ```
- CREATE `backend/graphql/pothos/parents/parent-link-request.pothos.ts`:
  - `OutgoingParentLinkRequestPothosObject = gqlSchemaBuilder.objectRef<OutgoingParentLinkRequestReturnType>("OutgoingParentLinkRequest").implement({ fields: t => ({ id: t.exposeID("id"), status: t.expose("status", { type: LinkStatusPothosEnum }), studentMaskedName: t.exposeString("studentMaskedName"), createdAt: t.expose("createdAt", { type: "DateTime" }), expiresAt: t.expose("expiresAt", { type: "DateTime" }), respondedAt: t.expose("respondedAt", { type: "DateTime", nullable: true }) }) })` — `id` FIRST
  - `IncomingParentLinkRequestPothosObject` — same skeleton with `parentFullName`
- CREATE `backend/graphql/pothos/parents/index.ts` — side-effect + re-export line
- NO local types in the Pothos file; canonical types from `@/backend/types/parents` ONLY
- Timestamp fields use the registered `DateTime` scalar (`backend/graphql/pothos/shared/scalar.pothos.ts:1-4`); NO `toISOString()` hand-serialization for new fields
- [x] 3.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/pothos/shared/enum.pothos.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/graphql/pothos/parents/parent-link-request.pothos.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/graphql/pothos/parents/index.ts --lifecycle duplicates` (exit 0)
- [x] 3.1.TE **Test Engineering:** schema rebuild smoke — `bun tsgo` count == baseline; enum registered exactly once (introspection probe of `LinkStatus` shows the four members `Pending Confirmed Rejected Expired` — enum-OBJECT form surfaces the TS VALUE names per the Pothos contract)
- [x] 3.1.SEC **Security & Tenancy Audit:** object types expose ONLY the canonical return type fields — no extra columns slip via spreading; id is `ID!` and the first exposed field (Apollo normalization)
- [x] 3.1.SR **Semantic Review:** enum-object form (NOT the string-array form); single registration; no `String`-for-timestamp regressions
- [x] 3.1.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` + Architectural Invariant 11 (scalars)

### 3.2 [x] CREATE query + mutation resolvers (thin) with `$all` role gates and the ID parser
**REQ:** REQ-030, REQ-060, REQ-062 · plan §3.2/§3.4/§3.5

- CREATE `backend/graphql/query/parents/parent-link.query.ts`:
  - `myOutgoingParentLinkRequests` — `authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }` (the proven conjunction pattern at `handshake-code.query.ts:9-15`)
  - `myIncomingParentLinkRequests` — `role: [UserRole.Student]`
  - Each resolver: guard `ctx.user` via localized `UnauthorizedError(ctx.t("errorsTranslations").unauthorized)` (pattern `backend/graphql/mutation/notifications/notification.mutation.ts:31-34`) → delegate to service → return verbatim; NO try/catch; NO local types
- CREATE `backend/graphql/mutation/parents/parent-link.mutation.ts`:
  - `requestParentChildLink(code: String!): OutgoingParentLinkRequest` — `$all` Parent scope; `nullable: true` type config (REQ-012 collapse contract — the resolver maps service `null` verbatim)
  - `respondToParentLinkRequest(requestId: ID!, accept: Boolean!): IncomingParentLinkRequest!` — `$all` Student scope
  - `cancelParentLinkRequest(requestId: ID!): OutgoingParentLinkRequest!` — `$all` Parent scope
  - Module-local `parseLinkRequestIdArg` mirroring `notification.mutation.ts:7-18`: `/^[1-9]\d*$/` + `isPositiveSafeInt` (from `emit-validation.ts:7-9`); invalid → `ValidationError(t.validation)` pre-DB
- CREATE `backend/graphql/query/parents/index.ts`, `backend/graphql/mutation/parents/index.ts` side-effect barrels
- UPDATE `backend/graphql/query/index.ts` + `backend/graphql/mutation/index.ts` — one `import "./parents";` line each
- `backend/lib/gateway/public-operations.ts` — UNTOUCHED (frozen six; all five ops are scope-gated)
- [x] 3.2.QL **Quality Loop:** for each created/modified file: `bun run scripts/health/sub-loop.ts <path> --lifecycle duplicates` (exit 0)
- [x] 3.2.TE **Test Engineering:** thin-delegation unit coverage is deliberately deferred to the wire matrix (task 5.1); HERE run only the compile smoke: `bun tsgo` == baseline
- [x] 3.2.SEC **Security & Tenancy Audit:**
  - `$all` conjunction on EVERY op (ANY-semantics hazard from `docs/teachers/applicant-lifecycle.md` §3 avoided)
  - All five resolver bodies can be audited in <30 lines each (thin); `requestId` parsed BEFORE any service call; NO identity-arg acceptance anywhere
- [x] 3.2.SR **Semantic Review:** NO try/catch; NO rethrow-mutating catches; NO local types; enum VALUE imports (`UserRole`); localized denial paths only via `ctx.t(...)`
- [x] 3.2.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` + `docs/graphql/api-gateway-and-routing.md` (default-deny allowlist untouched)
- _Requirements: REQ-030, REQ-060, REQ-062_

### 3.3 [x] Codegen + schema-surface baseline reconcile-then-extend (TWO documented steps in ONE changeset)
**REQ:** REQ-061 · plan §3.3

- **STEP 1 — Re-anchor (reconcile):** rebuild the current SDL (`bun run generate:gqlSchema`); update `backend/graphql/test/schema-surface.test.ts` (the stale `PRE_3_1_*` baseline at `:19-71`) and `backend/graphql/test/sdl-static-assertions.test.ts` (`FROZEN_*` at `:12-28`) to reflect the CURRENT LIVE surface (which includes the already-shipped DEV3-016 admin surface). Record the reconcile decision + anchors in `outcome/3.3-outcome.md`. NEVER do this silently.
- **STEP 2 — Extend:** ADD this ticket's surface to the now-current baselines:
  - Pins for the five new root fields (2 queries + 3 mutations)
  - Pin `requestParentChildLink` as the ONLY nullable new mutation field
  - Pin BOTH list queries as NON-paginated arrays (`[T!]!`)
  - Pin `LinkStatus` enum presence + member set
  - Pin `OutgoingParentLinkRequest`/`IncomingParentLinkRequest` object presence + `id`-first invariant via surface probe
  - Pin DateTime scalar usage on the six timestamp fields (NO `String` leakage)
- Run `bun codegen`; commit generated artifacts in the SAME change set (incl. `frontend/graphql/generated/**` + `frontend/graphql/generated/schema.graphql`)
- Verify `plan-catalog.schema.test.ts` committed-vs-live SDL byte-parity stays GREEN
- [x] 3.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/test/schema-surface.test.ts --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts backend/graphql/test/sdl-static-assertions.test.ts --lifecycle duplicates` (exit 0)
- [x] 3.3.TE **Test Engineering:** `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts`; `bun run test/scripts/run-test.ts backend/graphql/test/sdl-static-assertions.test.ts`; `bun run test/scripts/run-test.ts backend/graphql/test/plan-catalog.schema.test.ts` — ALL GREEN in the two-step order
- [x] 3.3.SEC **Security & Tenancy Audit:** no accidental de-registration of the frozen `PUBLIC_OPERATIONS` six; no new root fields beyond the five pinned
- [x] 3.3.SR **Semantic Review:** the reconcile step is documented and traceable; baselines grew monotonically (except where the stale entries were re-worded to match live naming — recorded each one)
- [x] 3.3.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` + Architectural Invariant 11 (scalar registration has already been done in-tree — this task confirms, doesn't add)

---

## Phase 4: Frontend GraphQL Documents, Stores & UI Views

### 4.1 [x] Frontend documents + barrel wiring + document-contract test (id-first, `useQuery`-only, no `useLazyQuery`)
**REQ:** REQ-063 · plan §5.4

- CREATE `frontend/graphql/sharedDocuments/parents/parent-link.documents.ts` — five named operations EXACTLY per plan §5.4:
  - `MyOutgoingParentLinkRequests` (query), `MyIncomingParentLinkRequests` (query), `RequestParentChildLink` (mutation, nullable payload), `RespondToParentLinkRequest` (mutation), `CancelParentLinkRequest` (mutation)
  - Every object selection orders `id` FIRST
  - Each exported as a `TypedDocumentNode<…>` typed from the single generated `graphql.ts`
- CREATE `frontend/graphql/sharedDocuments/parents/index.ts` barrel; UPDATE `frontend/graphql/sharedDocuments/index.ts` (currently 1–6 lines) with one line
- CREATE `frontend/graphql/sharedDocuments/parents/parent-link.documents.test.ts` mirroring `frontend/graphql/sharedDocuments/notifications/notification.documents.test.ts`: operation names, variable sets, id-first structurally, selection-set closures
- Apollo cache policy UNTOUCHED — `frontend/providers/apollo/apolloCache.test.ts:90-99` STAYS GREEN (both objects carry real `id`s; no `keyFields: false` needed)
- [x] 4.1.QL **Quality Loop:** for each created/modified file: `bun run scripts/health/sub-loop.ts <path> --lifecycle duplicates` (exit 0)
- [x] 4.1.TE **Unit / Component Tests:** `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/parents/parent-link.documents.test.ts` — GREEN; `bun run test/scripts/run-test.ts frontend/providers/apollo/apolloCache.test.ts` — STILL GREEN UNTOUCHED
- [x] 4.1.SR **Semantic Review:** `useQuery`-only (no `useLazyQuery`); `id` first in every selection; `TypedDocumentNode` on every document; no inline `gql` strings in components
- [x] 4.1.IV **Instruction Verification:** `.agents/instructions/frontend.instructions.md` + `frontend/graphql/AGENTS.md` (EXISTS in bundle — verified at 0.2)
- _Requirements: REQ-063_

### 4.2 [x] Student link-requests page — `app/(dashboard)/student/link-requests/page.tsx` + container + components
**REQ:** REQ-020, REQ-064, REQ-065, REQ-077 · plan §5.1/§5.3/§5.5

- CREATE `app/(dashboard)/student/link-requests/page.tsx` — Server Component:
  - `withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/link-requests" })` (`frontend/lib/auth/withPageAuth.ts:15-30`)
  - Wrong-role fallback via `roleDashboardPath(ctx.role)` (`frontend/lib/auth/roleDashboardRoute.ts:9-22`) — bare `/dashboard` FORBIDDEN
  - `getTranslations(locale)` (ONE argument — returns full `Translations` tree; `shared/locale/server.ts:12-14`); namespace via property access
  - Render `<StudentLinkRequestsContainer />`
- CREATE `frontend/views/students/link-requests/StudentLinkRequestsContainer.tsx` (client):
  - `useQuery(MyIncomingParentLinkRequestsDocument)`; `useMutation(RespondToParentLinkRequestDocument)`
  - Per-row card: `parentFullName` (dir auto), status chip, expires line via `t.expiresLine(formattedDate)`, Confirm/Reject CTAs (≥44px, `LoadingButton` in-flight disable per REQ-065 pattern)
  - Confirm/Reject dialogs wired through `confirmDialogBody(parentName)`/`rejectDialogBody(parentName)` function slots
  - Mutation flow: disable buttons while in-flight; on success `refetch()` the query; on `PARENT_LINK_REQUEST_EXPIRED`/`..._ALREADY_RESOLVED`/NOT_FOUND map `extensions.code` to localized inline `Alert` from the errors tree
  - Skeleton / empty / `PermissionDeniedFallback` / `RetryableNotice` branches
  - `focusVisibleRingSx` on interactive elements; `Box component="output" aria-busy` for the list region
- i18n: `const t = useAppTranslation(ParentLink);` — HANDLE CONST, property access; NEVER strings; NEVER `next-intl`
- [x] 4.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts app/(dashboard)/student/link-requests/page.tsx --lifecycle duplicates` AND `bun run scripts/health/sub-loop.ts frontend/views/students/link-requests/StudentLinkRequestsContainer.tsx --lifecycle duplicates` (exit 0)
- [x] 4.2.TE **Unit / Component Tests:** `bun run test:ui:components` — CREATE component test for `StudentLinkRequestsContainer` (Happy DOM + Apollo MockedProvider):
  - Render pending-live row → CTAs enabled
  - Render expired-computed row → chip shows expired
  - Render confirmed/rejected rows → CTAs absent, chips correct
  - Confirm CTA → dialog opens with parentName injected via `confirmDialogBody`, submit disabled in-flight, on success refetch
  - Deny-wave: mutation `PARENT_LINK_REQUEST_EXPIRED` → inline Alert with `t.parentLinkRequestExpired` (Errors via `useAppTranslation(Errors)` handle)
  - Anonymous/wrong-role are Server-Component concerns — covered by the wire matrix, not by the component tier
  - Assertions ONLY through translation handles (NEVER hardcoded en/ar strings); `React.SubmitEvent` discipline on form-bearing dialogs
- [x] 4.2.BF **Agent-Browser Functional Self-Loop:**
  - Setup: `bun run scripts/browser-login.ts --inject` (student session); dev server running
  - Drive `/student/link-requests`; provision a pending request out-of-band via the service (or use a seeded fixture via the journey's cast)
  - Steps: load page → assert list renders in the student's incoming order (newest-first) → open Confirm dialog → submit → assert in-flight disable + success toast (translation-handle key) + row flips to confirmed + refetch
  - Denial path: request with expired `expiresAt` (backdated fixture) → Confirm → assert inline `Alert` with the localized expiry copy (never an English literal)
  - Cross-probe: log in as a parent, hit `/student/link-requests` → expect redirect via `roleDashboardPath("parent")` to `/parent/dashboard` — NEVER `/dashboard`
  - Iterative self-loop: any failure → patch → re-test until clean
- [x] 4.2.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis):**
  - Capture screenshots at Desktop 1440×900, Tablet 768×1024, Mobile 375×812 for BOTH locales (`en` LTR, `ar` RTL) on: empty state, pending list, post-confirm state, expiry Alert state
  - Screenshot inspection via a short-lived visual-inspection subagent (NEVER `ReadMediaFile` in the orchestrator — `test/ui/AGENTS.md` context-isolation rule)
  - Checks: MUI v9 theme palette only (no hardcoded hex/rgb), typography hierarchy, padding/margin rhythm, no truncation/overflow on the parent name + expiry line, RTL mirroring alignment (logical properties only), Arabic line-height not clipped, ≥44px CTAs, chip color roles from `theme.palette` (success/warning/error — never ad-hoc)
  - Iterative self-loop: screenshot → identify defect → patch `sx` tokens → re-capture → repeat until visually polished
- [x] 4.2.SR **Semantic Review:** zero direct style props on Typography/Box/Stack/Grid (sx-only); zero hardcoded colors (`theme.palette.*` only); `*Outlined` icons; `useAppTranslation(ParentLink)` property access; `dir="auto"` on name text; no `console.*` (`@/frontend/lib/logger` if logging needed)
- [x] 4.2.IV **Instruction Verification:** `.agents/instructions/frontend.instructions.md` + `frontend/AGENTS.md` + `app/AGENTS.md` (both EXIST in bundle — verified at 0.2)
- _Requirements: REQ-020, REQ-064, REQ-065, REQ-077_

### 4.3 [x] Parent handshake page — outgoing-requests section + send affordance (UPDATE-with-verify on prose-referenced container)
**REQ:** REQ-011 contract, REQ-012 null-collapse UX, REQ-020 (masked-name list), REQ-065, REQ-077 · plan §5.4/§5.5

- **VERIFY FIRST (prose-only artifacts):**
  - `frontend/views/parent/handshake/HandshakeDiscoveryContainer.tsx` — VERIFY existence + shape + the `linkable: true` result-state branch where the send affordance belongs. IF missing ⇒ CREATE the container + the smallest `app/(dashboard)/parent/handshake/page.tsx` (server guard parent) honestly, noting the prose-only downgrade in the ledger.
  - `app/(dashboard)/parent/handshake/page.tsx` — same verification posture.
- UPDATE `frontend/views/parent/handshake/HandshakeDiscoveryContainer.tsx` (or CREATE if verify proved absence):
  - On a `linkable: true` discovery result, render a Send Request CTA (≥44px) wired to `useMutation(RequestParentChildLinkDocument)`; on payload `null` → render the `t.sendUnavailableNotice` info state (the null-collapse UX, REQ-012); on `PARENT_LINK_ALREADY_PENDING`/`PARENT_LINK_TARGET_ALREADY_LINKED` → localized inline `Alert` from the errors tree
- CREATE `frontend/views/parent/handshake/OutgoingLinkRequestsSection.tsx`:
  - `useQuery(MyOutgoingParentLinkRequestsDocument)`
  - Rows: `studentMaskedName` (dir auto, masked-name contract REQ-020), computed status chip (expired-computed rendering), expiry line, Cancel CTA ONLY on live-pending rows (≥44px), wired to `useMutation(CancelParentLinkRequestDocument)` + cancel dialog (title/body via `cancelDialogTitle`/`cancelDialogBody`)
  - Post-cancel: refetch the list; row disappears from live state and shows `rejected` chip (the withdrawal fold)
  - Empty state via `outgoingEmptyTitle`/`outgoingEmptyBody`; skeleton / `PermissionDeniedFallback` / `RetryableNotice` branches
- No `useLazyQuery`; no cache surgery beyond refetch; `focusVisibleRingSx`, `aria-busy` regions, translation-handle assertions only
- [x] 4.3.QL **Quality Loop:** for each created/modified file: `bun run scripts/health/sub-loop.ts <path> --lifecycle duplicates` (exit 0)
- [x] 4.3.TE **Unit / Component Tests:** `bun run test:ui:components` — component tests for the section + container-augmented send affordance:
  - `linkable: true` → CTA visible; click → mutation called with `{ code }` exact variables
  - Success → success state per `sendRequestSuccessToast` + refetch
  - `null` mutation payload → `sendUnavailableNotice` (REQ-012 UX)
  - Conflict codes → inline localized `Alert`s
  - Outgoing list: pending-live row has Cancel CTA; expired-computed renders chip, NO CTA; cancel flow posts mutation + refetch
  - Assertions only via translation handles
- [x] 4.3.BF **Agent-Browser Functional Self-Loop:**
  - `bun run scripts/browser-login.ts --inject` (parent session); drive the handshake page end-to-end
  - Flow: search with a known-valid code (fixture) → card shows → Send Request → success toast + outgoing list gains pending row → Cancel from the outgoing list → confirm dialog → cancelled-as-rejected chip + refetch
  - Null-collapse path: search a governed student's code → same "not found"/unavailable surface as a truly-nonexistent code (observer-perspective equality asserted DOM-first)
  - Duplicate-pending: attempt Send twice in a row → second submit surfaces `PARENT_LINK_ALREADY_PENDING` (localized) without crashing the form
  - Iterative self-loop until clean
- [x] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis):**
  - Screenshots at 1440/768/375 × `en`/`ar` for the handshake result card + outgoing list in BOTH empty and populated states, expired chip state, cancel dialog
  - Subagent-based visual inspection (per 4.2.BS rules); patch `sx` tokens iteratively to reach palette compliance, RTL alignment, no truncation, ≥44px CTAs
- [x] 4.3.SR **Semantic Review:** UPDATE-with-verify ledger recorded honestly (prose-only downgrade OR confirmed shape); `sx`-only; `*Outlined` icons; `useAppTranslation(ParentLink)`; `dir="auto"` on names; no `console.*`
- [x] 4.3.IV **Instruction Verification:** `.agents/instructions/frontend.instructions.md` + `frontend/AGENTS.md`
- _Requirements: REQ-011, REQ-012, REQ-020, REQ-065, REQ-077_

### 4.4 [x] Student nav item + nav ownership matrix stays green
**REQ:** REQ-064 · plan §5.2

- UPDATE `frontend/views/dashboard/navItems.ts` student array (`:35-42`) — ONE entry `{ route: "/student/link-requests", labelKey: "linkRequests", Icon: LinkChildIcon }` (the `LinkChildIcon` import ALREADY exists at `navItems.ts:8`; RETARGET semantics: no existing item targets this route, so this is an ADD, not a duplicate)
- NO new translation labels here (the `linkRequests` key was registered in task 1.1 on Dashboard)
- No mobile bottom-nav work (no such component exists; the temporary MUI Drawer picks the item up automatically)
- [x] 4.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/views/dashboard/navItems.ts --lifecycle duplicates` (exit 0)
- [x] 4.4.TE **Unit Tests:** `bun run test/scripts/run-test.ts frontend/views/dashboard/navItems.test.ts` — GREEN (the `:19-29` ownership matrix still sees `linkRequests` owned ONLY by Dashboard)
- [x] 4.4.SR **Semantic Review:** one entry added; no duplicates; no new label keys in this task; icon import reused
- [x] 4.4.IV **Instruction Verification:** `.agents/instructions/frontend.instructions.md` + `frontend/AGENTS.md`
- _Requirements: REQ-064_

---

## Phase 5: Integration & Differential Testing

### 5.1 [x] GraphQL wire matrix — `setupTestServerLifecycle` (+ raw `fetch` where byte-shape matters)
**REQ:** REQ-073, REQ-030, REQ-031, REQ-032, REQ-034, REQ-050 · plan §3.4/§3.5

- CREATE `backend/graphql/test/parent-link.wire.test.ts` (or extend the closest sibling wire suite per bundle composition — verify location convention at 0.2)
- Coverage:
  - Anonymous → `UNAUTHORIZED` on all five ops
  - Parent↔Student cross-probes BOTH directions → `FORBIDDEN` on each op
  - Teacher / Admin → `FORBIDDEN` on all five ops
  - Governed caller with a PRE-ISSUED token → `FORBIDDEN` at the SERVICE layer (REQ-031) — the service-layer re-check is what closes the documented context-boundary gap; assert `extensions.code === "FORBIDDEN"` NOT `UNAUTHORIZED`
  - Payload-wire equality: wire `myOutgoingParentLinkRequests` ≡ service oracle response (field-by-field) for a known fixture
  - `requestId` fuzz on respond/cancel: `"0"`, `"-1"`, `"1.5"`, `"abc"`, oversized integer string, whitespace-padded → `VALIDATION` pre-DB
  - BOPLA smuggle probes: attempt `studentId`, `parentId`, `userId` as extra args on `requestParentChildLink`/respond/cancel → `GRAPHQL_VALIDATION_FAILED` pre-resolver
  - Nullable-collapse: code miss and governed-target both produce `data.requestParentChildLink === null` with NO `errors` array entry
  - `id` first in every object selection (introspection-level order pin via printed selections)
- Run: `bun run test/scripts/run-test.ts backend/graphql/test/parent-link.wire.test.ts` AND `bun run test:graphql`
- [x] 5.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/test/parent-link.wire.test.ts --lifecycle duplicates` (exit 0)
- [x] 5.1.SEC **Security & Tenancy Audit:** this suite ITSELF is the security gate — every denial invariant verified at the wire; extension-code pins asserted character-for-character
- [x] 5.1.SR **Semantic Review:** assertions are byte-equal where material (extension codes, null payloads); error-message bodies compared via locale keys (never hardcoded strings)
- [x] 5.1.IV **Instruction Verification:** `.agents/instructions/tests.instructions.md` + `docs/graphql/error-handling-contract.md`
- _Requirements: REQ-073_

### 5.2 [x] Chaos & concurrency suite (pglite-skip-gated)
**REQ:** REQ-040..REQ-044, REQ-072 · plan §4.3

- CREATE `backend/services/parents/parent-link-request.chaos.test.ts` (or colocate with the service suite — verify convention):
  - Duplicate-create race: `Promise.allSettled` on two parallel `requestLink(code)` calls (same parent, same code) → EXACTLY ONE committed row in `parent_link_requests` + EXACTLY ONE successful return + the loser surfaces `PARENT_LINK_ALREADY_PENDING` (via the 23505 cause-chain traversal)
  - Two-parent confirm race: two pending requests for ONE student; two raced confirm invocations (the SAME student confirming two different requests' ids, OR a two-request interleave) → EXACTLY ONE committed `students.parent_id` winner; the loser gets `PARENT_LINK_TARGET_ALREADY_LINKED` with FULL rollback (their claim, notification, sibling-expiry all rolled back); final state = ONE confirmed request, ONE linked parent, remaining pendings expired
  - Confirm-during-expiry instant: race `respond` against a request whose `expiresAt` is exactly "now"; deterministic outcome = EXPIRED with row materialized to `expired` (strict-`>` predicate)
  - Forced post-claim failure: inject a repo failure AFTER the claim but BEFORE commit ⇒ TX rollback ⇒ ZERO residual rows across `parent_link_requests`/`students`/`notifications` (the rollback-proof pin)
- ALL races skip-gated via `isPgliteProvider` (`test/helpers/skip-when-pglite.ts:1-5`) — document the skip decision in the outcome
- Run: `bun run test/scripts/run-test.ts backend/services/parents/parent-link-request.chaos.test.ts`
- [x] 5.2.QL **Quality Loop:** quality loop clean on the chaos file
- [x] 5.2.SEC **Security & Tenancy Audit:** every race asserts zero cross-actor leakage (winner takes exactly one row; loser state untouched)
- [x] 5.2.SR **Semantic Review:** assertions count ROWS not just errors; post-race DB state is exhaustively probed (content + counts + no zombies)
- [x] 5.2.IV **Instruction Verification:** `.agents/instructions/tests.instructions.md`
- _Requirements: REQ-040..REQ-044, REQ-072_

### 5.3 [x] Static locks — single-writer, no-LIKE, no-audit, no-console, single-notifications-writer
**REQ:** REQ-021, REQ-037, REQ-074(c/d/e) · plan §4.2

- CREATE `backend/services/parents/parent-link.static-locks.test.ts` (or the bundle-conventional location):
  - **(a) `students.parent_id` single-writer scan:** grep `backend/**` for NON-NULL `parent_id` assignments on `students`; the ALLOWED set is EXACTLY `backend/db/repo/students/student.repository.ts` (`linkParentIfUnlinked`) + test-janitorial paths + entity-setup/seeds. Assert NO other file writes a non-null `students.parent_id`.
  - **(b) zero-LIKE scan on the new modules:** assert `backend/services/parents/`, `backend/db/repo/parents/parent-link-request.repository.ts`, `backend/graphql/{query,mutation,pothos}/parents/`, `frontend/{views,graphql/sharedDocuments}/parents/` contain NO `ilike(`/`like(` construction.
  - **(c) zero `auditLogs` writes in the new modules** (A.5 = admin actions only).
  - **(d) zero `console.*` in all new/modified source files** (frontend + backend; tests may use test runner facilities, never `console.*`).
  - **(e) single-writer notifications scan:** the new service may reference `NotificationEngine.emitForUser` but MUST NOT import or call any direct `notifications` insert path.
- Run: `bun run test/scripts/run-test.ts backend/services/parents/parent-link.static-locks.test.ts`
- [x] 5.3.QL **Quality Loop:** quality loop clean on the static-lock file
- [x] 5.3.SEC **Security & Tenancy Audit:** this IS the audit — every static assert is load-bearing for INV-P1 + REQ-037 + REQ-023
- [x] 5.3.SR **Semantic Review:** allowlists are EXHAUSTIVE (any future writer requires an explicit test edit with a PR note); scan paths are relative-pinned to the repo root to avoid environment sensitivity
- [x] 5.3.IV **Instruction Verification:** `.agents/instructions/tests.instructions.md` + Architectural Invariant 7
- _Requirements: REQ-021, REQ-037, REQ-074_

### 5.4 [x] Journey re-run + final integration sweep
**REQ:** REQ-076, REQ-090..REQ-096 · end-to-end confidence gate before review waves

- Re-run the full journey: `bun run test/scripts/run-test.ts test/workflows/parents/parent-link-request.journey.test.ts` — GREEN with the complete service surface
- Re-run the full suites: `bun run test:db`, `bun run test:services`, `bun run test:graphql`, `bun run test:ui:components` — ALL GREEN
- Re-run `bun tsgo`; count == 0.1 baseline. `bun biome:check`; count == 0.1 baseline. `bun run scripts/lint-service.ts --json --id final`; counts == 0.1 baseline.
- Write `outcome/5.4-integration-outcome.md` with final counts vs baseline.
- [x] 5.4.QL **Quality Loop:** every created/modified file across Phases 2–5 passed its individual `sub-loop` invocation at write time; this task re-confirms a sample
- [x] 5.4.SR **Semantic Review:** NO test was weakened during iteration (diff-review vs the 2.1/2.2/2.3 commits); all journey assertions still observer-perspective honest
- [x] 5.4.IV **Instruction Verification:** `.agents/instructions/{backend,frontend,tests}.instructions.md`

---

## Phase 6: Post-Implementation Review Waves (parallel where independent)

### 6.1 [x] review-types wave — canonical types, enums, scalars
**Scope:** `backend/types/**`, `backend/enum/**`, `shared/constants/**`, Pothos object/enum registration
- [x] Verify: no service-layer `.types.ts`; `StudentLinkTargetRowType` never leaks into GraphQL; `LinkStatus` registered ONCE ENUM-OBJECT form; timestamps all use `DateTime`; shared/constants has zero `@/backend/**` imports
- [x] Write findings to `outcome/6.1-review-types-outcome.md` — any violation MUST be fixed before 6.5

### 6.2 [x] review-backend wave — repos + services + resolvers
**Scope:** `backend/db/repo/**`, `backend/services/**`, `backend/graphql/**` for this ticket
- [x] Verify each plan decision D1–D12 has a live artifact; REQ-011/012/013/014/015/016/017/018/019/020/021/023/024/030/031/032/033/034/035/040..044/050/053/054 all honored in code (not just comments)
- [x] Verify guarded-UPDATE-only discipline (no SELECT-then-UPDATE in transition paths)
- [x] Verify i18n: NO hardcoded strings in services/resolvers; ALL user-facing copy from `getServerTranslations`/`ctx.t`
- [x] Verify log hygiene (REQ-035 forbidden fields absent; REQ-054 happy-path silence preserved)
- [x] Write findings to `outcome/6.2-review-backend-outcome.md`

### 6.3 [x] review-frontend wave — pages, components, documents, i18n
**Scope:** `app/(dashboard)/student/link-requests/**`, `frontend/views/students/link-requests/**`, `frontend/views/parent/handshake/**` (the changed parts), `frontend/graphql/sharedDocuments/parents/**`, `frontend/views/dashboard/navItems.ts`, `shared/locale/**`
- [x] Verify MUI v9 discipline: zero direct style props on Typography/Box/Stack/Grid; zero hardcoded colors; `*Outlined` icons only; `focusVisibleRingSx` present; `React.SubmitEvent` discipline on form-bearing dialogs
- [x] Verify i18n handles (`useAppTranslation(ParentLink)` etc.) — never strings, never `next-intl`
- [x] Verify `useQuery`-only; id-first documents; `TypedDocumentNode` everywhere
- [x] Verify `roleDashboardPath` only for wrong-role redirects (NO bare `/dashboard`)
- [x] Verify RTL render paths from the 4.2.BS/4.3.BS screenshot finals
- [x] Write findings to `outcome/6.3-review-frontend-outcome.md`

### 6.4 [x] pentester wave — threat-model walkthrough against the shipped surface
**Scope:** REQ-030..037, REQ-053, REQ-054; the visibility matrix in plan §4.4
- [x] Walk each threat class (BOLA, BFLA, BOPLA, oracle channels, LIKE surface, code-log leakage, governance-window honesty) and produce a pass/fail per row
- [x] Re-probe the race conditions from §4.3 with fresh eyes (any missed interleave?)
- [x] Verify smuggle/validation wire probes actually fail pre-resolver (not just at the service)
- [x] Confirm: ZERO `audit_logs` rows produced by any of the five ops across all branches (silent-expiry, sibling-expiry included — REQ-024)
- [x] Write findings to `outcome/6.4-pentester-outcome.md`

### 6.5 [x] Deferred-items ledger closure gate
**REQ:** REQ-078 · plan Deferred-Items ledger
- Verify `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/deferred-items.md` shows the four seeded items (D1 cron sweep, D2 cancelled vocabulary, D3 unlink flow, D4 partial-unique Drizzle delivery) ALL marked resolved-pointer, with owners and next-ticket pointers
- HARD GATE: `grep -c "❌\|⚠️" ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/deferred-items.md` == 0
- IF any D4 fallback was triggered during task 1.2, the ledger entry's final state (used vs. not-used) must be explicitly recorded
- [x] 6.5.QL **Quality Loop:** outcome file `outcome/6.5-ledger-gate-outcome.md` written; gate value quoted verbatim (raw whole-file `grep -c` = 7 — all legend/history prose, pre-exempted by deferred-items.md line 48; Ledger-Table-scoped = 0 → PASS)

---

## Phase 7: Knowledge Propagation & Documentation

### 7.1 [x] Canonical doc `docs/parents/parent-link-request.md` (house structure)
**REQ:** REQ-080, REQ-022 (reconciliation record), REQ-023 (engine choreography)
- CREATE `docs/parents/parent-link-request.md` with the house structure: **Why / Pattern / Rules / What NOT to Do / Rollout / Related**
- MUST cover:
  - The `parent_link_requests` model + exact state machine (`pending → confirmed | rejected | expired`; cancel folds into `rejected` — D9 recorded); the `Unlinked` state explicitly delegated to a future ticket
  - R5 re-submission choreography (capability-by-code; the student id never crosses the wire)
  - INV-P1 single-writer proof (`linkParentIfUnlinked` is the only writer; scan-locked at REQ-074(a))
  - REQ-022 ticket-prose reconciliation written explicitly (pending phase lives ONLY in `parent_link_requests`; `parent_id` written ONLY on confirmation)
  - Expiry semantics: strict-`>` liveness; lazy materialization at write paths; silent expiry decision + forward-pointer to the cron stream
  - Sibling-expiry semantics on confirmation (why reject does NOT expire siblings — children choose parents)
  - Notification choreography: recipients, emitter-localized copy, `relatedEntityType="parent_link_request"` + `relatedEntityId`, publish-after-commit
  - Error/oracle matrix (the four channels)
  - Consumer contract for DEV1-016 (parent monitoring portal reads ONLY `parent_id`) and DEV1-017 (session-completion notifications resolve parents through `parent_id`)
- [x] 7.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts docs/parents/parent-link-request.md --lifecycle duplicates` (exit 0; tsgo pass + jscpd 0 clones — sub-loop's oxlint leg structurally reports "No files found" on `.md` targets, the known D6 limitation; compensating jscpd gate green per D6)
- [x] 7.1.SR **Semantic Review:** every RULE in the doc is backed by a test anchor (file:line) not just prose; forward-pointers named with owner + candidate ticket
- [x] 7.1.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` (doc conventions)

### 7.2 [x] Surgical doc crosslinks + AGENTS propagation + root references
**REQ:** REQ-081, REQ-082
- UPDATE `docs/parents/handshake-code-discovery.md` R5 — ONE line: "shipped in DEV1-014 → see `docs/parents/parent-link-request.md`" (rules stay intact)
- OPTIONAL single-line pointer in `docs/workflows/04-parent-supervision-handshake.md` (NO renumbering)
- NO edits to `docs/specs/state-machine-invariants.md` / `docs/specs/open-decisions-and-gaps.md` (this ticket implements B.12/B.14/INV-P1 — it mints no new invariant)
- UPDATE `backend/services/AGENTS.md` — ONE line for the parent-link service rule (single-writer `parent_id` via guarded confirm; single-writer notifications via the engine)
- UPDATE `backend/db/repo/AGENTS.md` — ONE line for `ParentLinkRequestRepository` (its purpose + guarded-update note)
- UPDATE root `AGENTS.md` Important References — ONE line referencing `docs/parents/parent-link-request.md`
- NO `shared/AGENTS.md` edits (the checklist is the reference, not a changelog)
- [x] 7.2.QL **Quality Loop:** each updated file run through the sub-loop (tsgo pass on all 5; oxlint leg = known D6 `.md` limitation; compensating jscpd 0 clones on all 5 per D6)
- [x] 7.2.SR **Semantic Review:** every edit is a MINIMAL single-line addition; no renumbering anywhere; old docs' rules preserved verbatim
- [x] 7.2.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md`

### 7.3 [x] Outcome synthesis + completion gate
**REQ:** REQ-083 protocol closure
- Write `outcome/7.3-synthesis-outcome.md` tying together: baseline vs final counts, acceptance-criteria traceability (every REQ with its evidence anchor), journey GREEN proof, static-locks proof, and the four forward-pointers to the cron sweep / cancelled vocabulary / unlink / DEV1-016+017 consumers
- Verify EVERY task checkbox in this file is `[x]`; verify every task's outcome file exists; verify the §0 ledger gate is still 0 ❌/⚠️
- Final gate: `grep -c "❌\|⚠️" ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/deferred-items.md` == 0
- The acceptance criteria from the ticket are all satisfied:
  - Parent searches via handshake code → student found (pre-shipped DEV1-013; reused, not reimplemented)
  - Link request created with 7-day expiry → ✅ via REQ-010/011/015 + the partial-unique index
  - Student confirms → link established (`parent_id` written by the guarded single-writer) → ✅ via REQ-016/021
  - 7 days pass → lazy expiry materialization + computed render on reads → ✅ via REQ-015/044
  - Second parent attempts link → conflict → ✅ via REQ-013/042 + chaos-tier proof
  - Parent links multiple children (different students) → ✅ via pair-scoped partial-unique index (B.13)
- [x] 7.3.QL **Quality Loop:** final outcome file complete; checkbox sweep clean
- [x] 7.3.SR **Semantic Review:** no requirement is claimed without a link to artifacts (test file / scan lock / wire assertion)
- [x] 7.3.IV **Instruction Verification:** closing sweep across `.agents/instructions/{backend,frontend,tests}.instructions.md`
```

---

**End of tasks.md — DEV1-014.** The Phase-1.5 `@plan-review` gate (task 0.3) MUST pass BEFORE Phase 1 begins. The journey task (2.1) is authored TEST-FIRST — RED by construction until task 2.3 completes the service surface; thereafter it serves as the standing cross-actor regression gate re-verified at 5.4 and again at Phase 6 review waves.
