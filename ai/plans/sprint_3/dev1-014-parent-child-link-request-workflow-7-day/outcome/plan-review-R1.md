# Plan Review Report — DEV1-014 Parent-Child Link Request Workflow (7-Day Expiry)

## Review Round: R1 (Phase-1.5 `@plan-review` gate — Task 0.3)
## Date: 2026-09-01
## Reviewer: general-purpose subagent (single-agent gate per dispatch; checklist = `.agents/skills/plan-review/SKILL.md` + live-substrate reality from Task 0.2)
## Subagents Dispatched: none (dispatched as one gate agent; the "verify-*" dimensions below were executed in one pass)

---

## Summary

- **Total issues found:** 33
- **Blocking (CRITICAL/HIGH):** 5 (all FIXED in place — none unresolvable)
- **Medium (stale line anchors on live symbols):** 26 (all FIXED in place)
- **Low/Notes:** 2 (+1 recorded ledger row for a repo tooling limitation outside the plan's boundary)
- **Gate verdict: PASS-with-fixes.** Zero unresolvable spec-level contradictions. Every finding was either fixed surgically in `specs.md` / `plan.md` / `tasks.md` or recorded as ledger row D6 (📅 Forward, non-blocking). NO silent ignores. NO requirement/scope changes — anchor corrections and internal-consistency fixes only.

---

## Findings by Dimension

| Dimension | Reviewer pass | Issues Found | Status |
|---|---|---|---|
| Paths Existence | live tree verification (LS/Grep/Read) | 8 | ✅ Fixed |
| i18n Compliance | shared/AGENTS.md + shared/locale/AGENTS.md + parity baselines | 2 | ✅ Fixed |
| GraphQL Accuracy | backend/graphql AGENTS.md set + engine/emitters | 4 | ✅ Fixed |
| Component Props (MUI v9 / React 19) | frontend/AGENTS.md + frontend.instructions.md | 0 | ✅ PASS (no violations) |
| Permissions/Enums | builder.ts / enum-object rules / `$all` conjunction | 2 | ✅ Fixed |
| Existing Components | 0.2 outcome §1.5/§1.7 + fresh existence probes | 4 | ✅ Fixed |
| Architecture Compliance | backend AGENTS.md set (types/repo/services/graphql/schema/enum) + app/AGENTS.md | 2 | ✅ Fixed |
| Cross-Reference Consistency | specs↔plan↔tasks anchor sweep + live re-verification of every cited symbol | 13 | ✅ Fixed |

**Plan-review skill Step-4 checklist (cross-cutting rules) — verdict per rule:**

| Rule | Verdict |
|---|---|
| Type imports from `@/backend/types/**` only, no local Pothos types | ✅ Plan REQ-003 / tasks 1.4/3.1 compliant |
| Service boundaries (Server Components call services; Client Components use Apollo hooks) | ✅ pages guard via `withPageAuth` + render containers; data via `useQuery` documents |
| MUI v9: `sx` only, no style props | ✅ REQ-065 / tasks 4.2/4.3/6.3 pin it |
| i18n compile-time system in `shared/locale/`, no hardcoded text | ✅ REQ-002/051/052/066 + parity suites; `errors` namespace canonical-transport rule respected (flat keys, no near-duplicates) |
| Logging: no `console.*`, use `logger` | ✅ REQ-035/054 + static lock 5.3(d) |
| Test conventions: `runInRollback`, `tx` propagation, no `expect().rejects.toThrow()` | ✅ REQ-070 (repo tier) with the documented `test/workflows/` journey exception honored (task 2.1 forbids `runInRollback` — matches `test/workflows/AGENTS.md` rule 1) |
| GraphQL documents: named ops, `id` FIRST, `TypedDocumentNode`, hooks from `@apollo/client/react` | ✅ after fix #5 (document-const naming convention made explicit in 4.1; 4.2/4.3 shorthand normalized) |
| Pothos enum-object registration ONCE in `shared/enum.pothos.ts` | ✅ plan §3.2 / task 3.1 |
| DomainError-only resolver errors; `ctx.t` localization; locale propagation | ✅ REQ-050/062 |
| DataLoader: root-list reads only, no per-parent field resolvers | ✅ plan notes `dataloader-batching.md` N/A (specs §3 standards line) |

---

## Detailed Findings

Severity key: **HIGH** = would misdirect an implementation subagent into creating duplicates / editing wrong files; **MEDIUM** = stale line anchor on a live symbol (fails verify-then-claim spot checks); **LOW** = cosmetic / naming consistency.

### Dimension 1: Paths Existence

1. **[HIGH]** tasks.md 2.1 said "CREATE the journey harness … must be built from scratch" and 2.1.IV said "`test/workflows/AGENTS.md` (to be created with harness rules)".
   - **Location:** `tasks.md` task 2.1 (harness bullet + 2.1.IV)
   - **Expected:** harness EXISTS (`test/workflows/helpers/` barrel `index.ts:24-29`; `TrackedFixtures` `tracked-fixtures.ts:173`; `provisionStudentActor` `actor-context.ts:88`; `provisionParentActor` `actor-context.ts:122`; `SpiedFanoutTransport` `spied-transport.ts:49`; `test/workflows/AGENTS.md:7-10` "scaffolded" is REAL).
   - **Actual:** plan text pre-dated the substrate; contradicted specs.md verify-then-claim note ("The journey harness IS scaffolded") and ledger D5.
   - **Fix Applied:** 2.1 harness bullet rewritten CREATE→REUSE (import from `@/test/workflows/helpers`; extend only with a genuinely new helper — never fork); 2.1.IV now cites `test/workflows/AGENTS.md` (EXISTS). Ledger D5 note updated to record the fix.

2. **[HIGH]** specs.md verify-then-claim note claimed the frontend surfaces (`frontend/views/parent/handshake/*`, `frontend/views/students/dashboard/*`, `app/(dashboard)/parent/handshake/page.tsx`) were "PROSE-VERIFIED only … NOT in the bundle".
   - **Location:** `specs.md` header note (bullet 6); consistent drift in REQ-064 ("PROSE-verified, UPDATE-with-verify")
   - **Expected:** `HandshakeDiscoveryContainer.tsx` (152 lines), `app/(dashboard)/parent/handshake/page.tsx` (41 lines, `withPageAuth` at `:34`), and `frontend/views/students/dashboard/*` (incl. `HandshakeCodeCard.tsx`) ALL EXIST — verified by Task 0.2 §1.7 and re-confirmed on disk at this gate.
   - **Actual:** "NOT in the bundle" was stale prose.
   - **Fix Applied:** note rewritten to "EXIST in the bundle … UPDATE-with-verify-at-implementation (verify container SHAPE before editing; no CREATE downgrade expected)"; REQ-064 wording aligned.

3. **[HIGH]** navItems path wrong across specs REQ-064, plan §5.2, tasks 1.1/4.4/6.3: `frontend/views/dashboard/navItems.ts` / `navItems.test.ts`.
   - **Location:** 5 occurrences across the three plan files
   - **Expected:** live paths are `frontend/views/dashboard/nav/navItems.ts` (student array `:103-109`, `LinkChildIcon` import `:11`) and `frontend/views/dashboard/nav/navItems.test.ts` (ownership-matrix doc `:7-17`).
   - **Actual:** cited a flat path that does not exist.
   - **Fix Applied:** all five occurrences corrected (paths + line anchors + the 4.4.QL sub-loop path + 1.1.TE/4.4.TE runner paths + 6.3 scope line).

4. **[HIGH]** specs REQ-037 anchored `escapeLikeWildcards` at `backend/services/admin/user-management.service.ts:12`.
   - **Location:** `specs.md` REQ-037
   - **Expected:** live anchor `backend/lib/db/escape-like-wildcards.ts:37` (verified; no such symbol in user-management.service.ts).
   - **Fix Applied:** anchor corrected.

5. **[MEDIUM]** specs REQ-062 / plan §3.2 / tasks 3.2 anchored the canonical ID parser at `notification.mutation.ts:7-18` (a doc-comment range) and the `ctx.user` guard at `:31-34` (also doc-comment).
   - **Expected:** live code anchors: `parseNotificationIdArg` at `notification.mutation.ts:81`; `ctx.user` guard at `:114-116`.
   - **Fix Applied:** all three files corrected (same fix pattern as Task 0.2's "anchor is doc-comment → DRIFTED" verdicts).

6. **[MEDIUM]** specs REQ-004/plan L7 cited `notification-engine.service.ts:158-288` / `:159-235` for the engine composition.
   - **Expected:** file is 182 lines; live anchors `emitForUser` `:43-78`, caller-tx receipt-without-publish branch `:65-68`, `publishReceipts` `:117-123` (Task 0.2 §1.1).
   - **Fix Applied:** corrected in both files (specs header + REQ-004 bundle; plan header + §4.2 receipt-no-publish anchor).

7. **[MEDIUM]** plan §2.1 READ-ONLY anchor table drifted on four rows: `enums.ts:28` (live `:54`), `students.ts:18,27` (live `:32,41`), `students.ts:17,26` (live `:31,40`), `users.ts:16-22` (live `:30-35`); same `enums.ts:28` in specs header note + REQ-010 + plan §1.1.
   - **Fix Applied:** all six occurrences corrected to live lines.

8. **[LOW]** specs REQ-066 / tasks 1.1 cited `shared/locale/types/message.ts:12-24`; the `Translations` interface actually spans `:13-25`.
   - **Fix Applied:** corrected in both files.

### Dimension 2: i18n Compliance

9. **[MEDIUM]** specs REQ-052 / tasks 1.1 cited the notifications parity suite as `notifications-namespace.parity.test.ts:8-35` for the `MANDATED_KEYS` baseline.
   - **Expected:** `MANDATED_KEYS` lives at `:50`; the **26-key baseline, 4 function slots, exactly seven `type*` keys claims are CORRECT** (verified live this gate: 26 string entries, 4 `=> string` slots, 7 `type*` keys).
   - **Fix Applied:** anchor corrected to `:50` with the verified-baseline note; the 26→32 / 4→7 arithmetic retained (it is right).

10. **[LOW]** tasks 1.1/2.3 + plan §4.2 cited the `handshakeCodeInvalid` precedent at `shared/locale/en/errors/index.ts:48`; live line is `:49` (types mirror at `types/errors/index.ts:95`).
    - **Fix Applied:** three occurrences corrected.

### Dimension 3: GraphQL Accuracy

11. **[MEDIUM]** specs REQ-030 / plan §3.4 anchored the pre-resolver localized `FORBIDDEN` at `backend/graphql/pothos/builder.ts:40-51` / `:41-46` (import lines).
    - **Expected:** live `ForbiddenError(getServerTranslations(...).errorsTranslations.forbidden)` at `builder.ts:119`.
    - **Fix Applied:** corrected.

12. **[MEDIUM]** specs REQ-030 / plan §5.2(BFLA row) anchored the `$all` conjunction precedent at `handshake-code.query.ts:9-15` (doc-comment).
    - **Expected:** live `authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }` at `:60-66`.
    - **Fix Applied:** corrected.

13. **[MEDIUM]** specs REQ-060 / plan D11 / tasks 3.1 anchored the DateTime scalar at `scalar.pothos.ts:1-4` + builder Scalars slot `builder.ts:16-18`.
    - **Expected:** `DateTimeScalar = gqlSchemaBuilder.addScalarType("DateTime", …)` at `scalar.pothos.ts:28`; `Scalars` slot at `builder.ts:76`.
    - **Fix Applied:** corrected in all files.

14. **[LOW]** tasks 4.2/4.3 referenced document consts in a shorthand form (`MyIncomingParentLinkRequestsDocument`) inconsistent with the layer convention (`{camelCase}QueryDocument` / `{camelCase}MutationDocument`, per `frontend/graphql/sharedDocuments/AGENTS.md`; live precedent `notification.documents.ts:30` `myNotificationsQueryDocument`; plan §5.4 component tree already used the correct form).
    - **Fix Applied:** task 4.1 now pins the five exact const names; tasks 4.2/4.3 hook references normalized.

### Dimension 4: Component Props (MUI v9 / React 19)

15. **[—] No violations.** REQ-065 and tasks 4.2/4.3/6.3 already pin `sx`-only styling, `theme.palette.*` tokens, `*Outlined` icons, `React.SubmitEvent`, `Box component="output" aria-busy`. `focusVisibleRingSx` EXISTS (`frontend/components/ui/focusRing.ts`); `PermissionDeniedFallback` / `RetryableNotice` EXIST (`frontend/components/ui/`); `TestWrapper` + `translation-preload.ts` EXIST (`test/ui/components/`).

### Dimension 5: Permissions/Enums

16. **[MEDIUM]** specs REQ-011/REQ-031 + plan §1.1(4)/§1.3(D5 context)/§6 anchored the context-factory governance window at `gqlContextFactory.ts:91-104` (a DEFAULT_LOCALE region).
    - **Expected:** live `ctx.user` assembly (fetches the full user row, applies NO governance filter) at `:206-216`.
    - **Fix Applied:** five occurrences corrected.

17. **[MEDIUM]** specs REQ-016 anchored the `NOTIFICATION_NOT_FOUND` oracle rule at `notification-engine.service.ts:254-276` (impossible — file is 182 lines).
    - **Expected:** live classifier arm at `:161`.
    - **Fix Applied:** corrected.

### Dimension 6: Existing Components

18. **[MEDIUM]** specs REQ-004 bundle cited stale anchors for six substrate artifacts (all verified DRIFTED by Task 0.2): `emitForUser :159-235`, `isGovernanceExcludedFromDiscovery :3-18`, `findDiscoveryByHandshakeCode :48-81`, `grantFreeTrialOnce :100-115`, `findLocalesByIds :63-92`, `with-transaction import :13`, `ConflictError :90-99`.
    - **Expected (live):** `:43-78`+`:117-123` · `:39-59` · `:128-165` · `:206` · `:152-186` · `user-management.service.ts:62` · `:170-182`.
    - **Fix Applied:** REQ-004 bundle rewritten with live anchors + a "re-verified by Task 0.2" pointer; plan §4.2 pipeline mirrors the same corrections (`helpers :39-59`, `findLocalesByIds :152-186`, `with-transaction :62`, `maskFullName` import `student-handshake.service.ts:49`, `ConflictError :170-182` at §3.4).

19. **[MEDIUM]** plan D2 cited `setDeletedOnce` at `admin-user.repository.ts:327-347`; live `:355`. **Fix Applied.**

20. **[MEDIUM]** plan D4 / tasks 2.3 cited `isUniqueViolation` at `user-provisioning.helpers.ts:29-44` (doc-comment); live fn `:54`. **Fix Applied.**

21. **[MEDIUM]** plan §4.1 / tasks 2.2 cited the repo row-shape precedent `AdminUserDirectoryRow` at `admin-user.repository.ts:41-61`; the interface actually lives in the sanctioned sibling file `backend/db/repo/admin/admin-user-row-types.ts:72`.
    - **Fix Applied:** citation corrected with the sibling-file pattern named.

22. **[MEDIUM]** specs REQ-032/REQ-034 + plan §3.4/§6 cited the `markReadOnce` precedent at `notification.repository.ts:128-139`; live `:269-281`. **Fix Applied (4 occurrences).**

23. **[MEDIUM]** specs REQ-043 / plan §4.3 / tasks 5.2 cited `test/helpers/skip-when-pglite.ts:1-5`; live `isPgliteProvider` at `:48-50` (Task 0.2). **Fix Applied (3 occurrences).**

24. **[MEDIUM]** specs header note cited the harness-import anchors `fanout-transport.test.ts:12` / `notification-engine.emit.test.ts:31` (doc-comment lines); live imports at `:25` / `:70`. Also plan §4.4 (`:12` → `:25`). **Fix Applied.**

### Dimension 7: Architecture Compliance

25. **[—] No violations of layer rules found.** All CREATE claims checked against the live tree and are correct: `backend/services/` has NO `parents/` subdir (root barrel = admin/auth/billing/shared/students/teachers exactly as plan §4.2 states); `backend/db/repo/parents/` = only `parent.repository.ts` + index (`export * from "./parent.repository";` exactly as plan §4.1 states); `backend/db/schema/parents/` = only `parents.ts` + barrel; NO `parents/` under `backend/graphql/{query,mutation,pothos}` (NEW subtrees correct; side-effect-barrel wiring `import "./parents";` matches layer AGENTS.md); `frontend/graphql/sharedDocuments/` has NO `parents/` subdir (top barrel = exactly 6 lines as plan §5.4 states); `backend/types/parents/index.ts` = `export * from "./parent.types";` exactly as plan §2.3 states; `shared/constants/index.ts` = exactly 3 lines as plan §2.4 states. Barrels, enum-object registration, canonical types, guarded-update repo patterns, DomainError usage, and `db push`-only delivery all comply with the layer AGENTS.md files.

26. **[LOW]** tasks 2.1 journey step claimed the cast includes `Admin` — no; specs §2.9 actor table has NO admin actor (zero audit rows by design). Verified the task text already lists exactly Parent A/B, Student S, Governed G, Linked L — consistent. No edit needed (recorded here as a checked-and-passed item, not a silent ignore).

### Dimension 8: Cross-Reference Consistency

27. **[MEDIUM]** specs REQ-020 cited `maskFullName` "referenced by `student-handshake.service.ts:7`"; live import `:49`, usage `:151`. **Fix Applied** (also plan §4.2 step 5).
28. **[MEDIUM]** specs REQ-002 cited `shared/locale/server.ts:12-14` / `server-graphql.ts:2-4`; live `:15-17` / `:3-5`. **Fix Applied** (tasks 4.2 `server.ts` cite fixed too).
29. **[MEDIUM]** specs REQ-023 cited engine co-presence validation `emit-validation.ts:32-49`; live `validateEntityRef` call at `:79`. **Fix Applied.**
30. **[MEDIUM]** specs REQ-063 / plan §5.4 / tasks 4.1 cited the frozen cache-policy inventory at `apolloCache.test.ts:90-99` (a helper region); the `keyFields:false` assertions live at `:167-192`. **Fix Applied (3 occurrences).**
31. **[MEDIUM]** specs REQ-004/REQ-050 + plan §3.4 anchored `ConflictError(code, message)` at `errors.ts:90-99` and `NotFoundError` entity-form at `:14-17`; live `:170-182` / `:37-41`. **Fix Applied (4 occurrences).**
32. **[MEDIUM]** specs/plan blocking-dependency line cited `registration.service.ts:22-48` for `registerUser`; live fn at `:79` (doc block at `:22`). **Fix Applied (2 occurrences).**
33. **[LEDGER]** Repo tooling limitation (NOT a plan defect): `scripts/health/sub-loop-checks.ts` `checkOxlint` exits 1 on any `.md` target ("No files found to lint" — 0 files, 0 diagnostics; structural inapplicability). Cannot be fixed inside this plan's doc-only boundary → recorded as ledger **D6 (📅 Forward, future repo-tooling ticket)** with the compensating check (`bunx jscpd -c .jscpd.json <file>`, exit 0) documented. Source: 0.1/0.3. Not a silent ignore — it is the reason this gate's quality loop runs direct jscpd.

**Historical-record note (explicit disposition, not an ignore):** tasks.md lines 50–63 (the 0.2 verification bullets) retain their original cited anchors because they are the COMPLETED record of what Task 0.2 was asked to verify; the authoritative live anchors for every one of them are in `outcome/0.2-prereq-outcome.md` §1 (and two bullets already carry inline 0.2 annotations). Rewriting executed-verification history would falsify the audit trail.

---

## Fix Subagents Dispatched

| Subagent | Target Files | Findings Fixed | Status |
|---|---|---|---|
| gate agent (this task, in-place surgical edits) | `specs.md` | 17 fixes | ✅ Complete |
| gate agent | `plan.md` | 30 fixes | ✅ Complete |
| gate agent | `tasks.md` | 21 fixes | ✅ Complete |
| gate agent | `deferred-items.md` | D5 note updated (0.3 wording fix recorded) + D6 row added | ✅ Complete |

---

## Post-Fix Verification

- [x] All stale references resolved — repo-wide pattern greps over the three plan files for every corrected anchor return **zero** hits (the only remaining old-form anchors are the historical 0.2 bullets, disposition above).
- [x] No requirement/scope changes: every REQ, decision D1–D12, acceptance criterion, and test target is semantically identical pre/post gate (only `path:line` evidence, prose-status of verified artifacts, and document-const naming were corrected).
- [x] AC traceability complete — specs §4 matrix untouched and still 1:1 with tasks phases.
- [x] Quality loop on all modified plan files: the sub-loop oxlint-on-md limitation (ledger D6) applies; compensating `bunx jscpd -c .jscpd.json <file>` run on ALL SIX touched/created `.md` files — **exit 0, 0 clones each** (verbatim outputs in `outcome/0.3-plan-review-outcome.md` §6).
- [x] Re-check against `.agents/skills/plan-review/SKILL.md` Step 4 after fixes: **"Plan passes all AGENTS.md rules for affected layers."**

---

## Lessons for Future Plans

- Author plans AFTER substrate verification or annotate unverified anchors: 26 of 33 findings were `path:line` drift that a single verify pass (0.2-style) would have prevented.
- Doc-comment line ranges are not code anchors — cite the symbol's definition line (0.2 verdict vocabulary: "anchor is doc-comment ⇒ DRIFTED").
- "Currently <contents>" claims about barrels are cheap to verify and high-value: every such claim in this plan checked out EXACTLY — keep doing that.
- Layer AGENTS.md directory-layout listings can themselves be stale (query/parents listed that doesn't exist; mutation/parents omitted correctly) — the live tree, not the layout listing, is ground truth.
- Task-historical checkbox sections should never be retro-edited; record corrections in outcomes/ledger instead (0.2/0.3 pattern).

---

## Traceability

**Plan files modified:**
- `specs.md` — header verify-then-claim notes (engine/enum/harness-import/dashboards bullets), REQ-002, REQ-004 bundle, REQ-010, REQ-011, REQ-016, REQ-020, REQ-023, REQ-030, REQ-031, REQ-032, REQ-037, REQ-043, REQ-050, REQ-052, REQ-060, REQ-062, REQ-063, REQ-064, REQ-066 — stale anchors → live anchors; dashboards note PROSE→EXISTS.
- `plan.md` — header deps, §1.1, §1.3 D2/D4/D11, §2.1 table, §3.2 map, §3.4 error map, §4.1, §4.2 pipelines, §4.3, §4.4, §5.1, §5.2, §5.4, §5.6, §6 tables — same anchor class.
- `tasks.md` — 1.1 (errors line, parity anchor, nav path, message span, TE runner path), 2.1 (harness REUSE per D5 + IV), 2.2, 2.3, 3.1, 3.2, 4.1 (const-naming convention), 4.2, 4.3, 4.4 (+QL/TE paths), 5.2, 6.3 scope.
- `deferred-items.md` — D5 note (0.3 wording-fix recorded); **D6 added** (📅 Forward — sub-loop oxlint-on-md tooling limitation); Seed Verification re-confirmed 0 open ❌/⚠️.

**Outcome knowledge base updated:**
- This report saved as: `ai/plans/sprint_3/dev1-014-parent-child-link-request-workflow-7-day/outcome/plan-review-R1.md`
- Companion summary: `outcome/0.3-plan-review-outcome.md` (checklist results, severity counts, ledger delta, gate verdict, Phase-1 carry-forward).
