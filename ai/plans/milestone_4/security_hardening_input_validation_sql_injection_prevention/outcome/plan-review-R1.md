# Plan Review Report — Security Hardening: Input Validation & SQL Injection Prevention

## Review Round: 1 (Phase 1.5 gate — executed at plan generation time)
## Date: 2026-10-08
## Reviewer: independent review subagent (plan-review protocol), `agent-8`, read-only

---

## Summary

- **Total issues found:** 14 (all dimensions, before fixes)
- **Blocking (CRITICAL/HIGH):** 8
- **Medium:** 5
- **Low/Notes:** 3 (+2 PASS notes)
- **Outcome:** all findings fixed in the plan files in the same session; verdict after fixes: **Plan passes all AGENTS.md rules for affected layers** (conditional on the fixes below, which are applied).

---

## Findings by Dimension

| Dimension | Issues Found | Status |
|---|---|---|
| Path existence & citation accuracy | 5 | ✅ Fixed |
| Cross-reference consistency (census, verifying artifacts, D-ids) | 3 | ✅ Fixed |
| GraphQL rules / test conventions (batchMax, live-server conflict, spy rule, ctx.t key) | 4 | ✅ Fixed |
| i18n compliance | 1 | ✅ Fixed |
| Logging | 0 | ✅ Pass |
| Type pattern compliance | 0 | ✅ Pass (note: `OriginGuardResult` kept module-local in `app/api/graphql/origin-guard.ts` — considered colocating beside `TransportGuardResult` in `backend/types/gateway/gateway-context.types.ts`; kept app-layer because the guard module is route-composition code and the types file is backend-owned; either home is defensible) |
| Architecture / SDL / MUI | 0 | ✅ Pass |
| Documentation-truth scope | 2 | ✅ Fixed |
| Instruction-file hygiene | 0 | ✅ Pass |
| Deferred items | 0 | ✅ Pass |
| REQ↔task traceability | 0 | ✅ Pass |

---

## Detailed Findings (with fixes applied)

### Dimension 1: Cross-reference consistency

1. **[HIGH] ilike census cited a nonexistent table** — `plan.md §5.3` is the transport-guard code block, not a census table.
   - **Fix:** created `plan.md §5.15 "ilike() Call-Site Census (single source of truth for task 3.1 Lock b)"` with counting semantics + the 8-file/14-line table; `specs.md` REQ-020 AC2 and `tasks.md` 3.1/3.1.SR re-pointed at §5.15.
2. **[HIGH] census numbers wrong** — "10 files / 14 call sites" mixed counting methods; `teacher.repository.matching.helpers.ts:134-138` was the wrong range (actual call sites `:138, :139, :141, :142`); the lock regex also matches docblock prose (7 comment lines; 2 prose-only files).
   - **Fix:** census corrected to **8 files / 14 call-site lines / 19 call occurrences**, range corrected to `:138-142`, comment-stripping semantics specified (strip `/* */` + `//`; prose-only files `admin-user.repository.ts:28` + `admin-user-row-types.ts:50` excluded), per-line counts re-frozen at implementation.
3. **[LOW] "48 authScopes references" brittle/inaccurate** — removed the count; the task now instructs grep-and-verify.

### Dimension 2: Path existence & citation accuracy

4. **[HIGH] `backend/services/auth/auth.service.test.ts` does not exist** — real home `backend/db/test/logic/auth/auth.service.test.ts`.
   - **Fix:** `specs.md` §8 REQ-011 verifying artifact corrected; task 2.3 test list re-pinned.
5. **[HIGH] three CSV "cell builder" citations were delegation sites; one real builder unlisted** — `studentsCsvExport.ts:28` → `students-directory-csv.ts` → `directory-csv.ts`; `AdminApplicantsPanel.tsx:77` (Blob line) → `applicants-directory-csv.ts` → `directory-csv.ts`; `PlatformAnalyticsContainer.tsx:141` → real builder `frontend/views/admin/analytics/platform-analytics-csv.ts:50`.
   - **Fix:** exporter target list corrected to the 3 real cell builders (`walletLedgerCsv.ts:16-18`, `directory-csv.ts:37`, `platform-analytics-csv.ts:50`); delegation chains documented as covered transitively.
6. **[HIGH] core CSV claim false for PrintExportDialog** — `frontend/views/shared/print-export/PrintExportDialog.tsx:36-42` ALREADY implements `neutralizeCsvFormulas` (CWE-1236 docblock `:29-34`); task 3.4 as written would have created a duplicate implementation (violating its own single-sourcing rule + `check:duplicates`).
   - **Fix:** task 3.4 + `plan.md §5.7` + `specs.md` REQ-030 AC3 re-scoped to EXTRACT the existing helper verbatim into `frontend/utils/csv-formula.ts`, convert PrintExportDialog to the import, and apply to the 3 unguarded builders; extraction-regression test added (byte-level output comparison).
7. **[LOW] `sql.raw` claim incomplete** — second dev site `backend/db/scripts/ensureIdempotentMigrations.ts:310`; `scripts/dbActions/` has zero hits.
   - **Fix:** both sites enumerated in `specs.md` header + `tasks.md` 3.1 Lock (a).
8. **[LOW] `public-operations.ts:38-41` holds FOUR auth members, not three** — **Fix:** `specs.md §1.3` reworded (three brute-force-relevant members; `logout` is cookie-clear only).

### Dimension 3: GraphQL rules / test conventions

9. **[HIGH] REQ-010 AC3 unsatisfiable** — installed `BatchHttpLink` default `batchMax = 0` (unlimited) (`node_modules/@apollo/client/link/batch/batchLink.js:36`); a lone server cap would break legitimate dashboard bursts.
   - **Fix:** task 1.3 now sets an EXPLICIT `batchMax: 10` on the `BatchHttpLink` construction (`frontend/providers/apollo/AppApolloProvider.tsx:99`, docblock cross-referencing the server constant); AC3 reworded to "server cap == explicit client cap"; `plan.md` Decision 3 updated.
10. **[HIGH] REQ-050 AC7 collided with the live-server test architecture** — resolver-level limiter runs in the dev-server process; `clearRateLimitStore()` has no cross-process effect; testClient suites would flake.
   - **Fix:** `enforceAuthMutationRateLimit` mirrors the transport tier's sanctioned `TEST_CI`/`TEST_SERVER` bypass VERBATIM including the production-guard throw (`app/api/graphql/rate-limit.ts:34-48`); real enforcement exercised by in-process suites; `plan.md` §10 rollout note updated.
11. **[HIGH] task 2.3 "spy the service" + "direct resolver calls" violated test architecture** — `frontend/graphql/test/AGENTS.md` rule 10 forbids backend imports there; resolvers are anonymous side-effect registrations (cannot be invoked directly).
   - **Fix:** limiter tests re-pinned to a NEW in-process suite `backend/graphql/test/auth-rate-limit.test.ts` (built-schema execution, precedent: `schema-surface.test.ts` anonymous probes); ordering proof needs ZERO spies (exhausted bucket + nonexistent email → `RATE_LIMIT_EXCEEDED` not `UNAUTHORIZED`); `auth.test.ts` stays wire-level only.
12. **[MEDIUM] `ctx.t("auth")` — nonexistent namespace key** — `keyof Translations` is `authTranslations`.
   - **Fix:** `plan.md §5.5` snippet + task 2.3 use `ctx.t("authTranslations")` (key verified at `backend/services/auth/auth.service.ts:173`).

### Dimension 4: i18n compliance — 1 finding (see #12); otherwise PASS (reuse-only verified: `rateLimitExceeded`, `forbidden`, `badRequest`, `invalidOrigin` exist in en + ar + type slots; zero new keys/namespaces planned).

### Dimension 8: Documentation-truth scope

13. **[MEDIUM] stale-doc census incomplete** — six additional live "stub" sites: `docs/auth/user-registration.md:355` + `:389`, `backend/graphql/test/helpers/admin-session-governance.wire.ts:15`, `backend/graphql/test/admin-session-governance.query.test.ts:15`, `backend/graphql/test/admin-session-governance.mutation.test.ts:23`, `app/api/cron/expire-subscriptions/test/expire-subscriptions-route.test.ts:49` + `:85` (all grep-verified).
   - **Fix:** `specs.md` REQ-080 AC1 + `tasks.md` 5.1 extended to the full ten-site census.
14. **[MEDIUM] task 3.4 left `directory-csv.ts:23-27` docblock describing the old behavior** ("intentionally not applied").
   - **Fix:** docblock update scheduled inside task 3.4 (+ 3.4.SR gate).
15. **[MEDIUM] task 2.4 required editing a file absent from its Files list** — `cronSweepRateLimiter` is a module-private `const` (`backend/lib/gateway/cron-endpoint.ts:79-83`).
   - **Fix:** task 2.4 Files list now declares `backend/lib/gateway/cron-endpoint.ts` with the one-`export`-keyword change.

---

## Fix Subagents Dispatched

| Subagent | Target Files | Findings Fixed | Status |
|---|---|---|---|
| orchestrator (in-session edits) | `specs.md`, `plan.md`, `tasks.md` | all 14 | ✅ Complete |

## Post-Fix Verification

- [x] All stale references resolved (grep confirms: no `plan.md §5.3` census refs, no `ctx.t("auth")`, no `auth.service.test.ts` at the wrong path, no `134-138` range)
- [x] Traceability re-run: zero misses in both directions (`specs.md` ↔ `tasks.md`)
- [x] Anti-pattern sweep re-run: zero hits (no `Translation.` enum, no two-arg `getTranslations`, no `@/frontend/utils/logger`, no raw `bun test`, no bottom-nav)
- [x] D1–D8 all present in `deferred-items.md` and referenced from specs/plan/tasks
- [x] New citations verified against the tree (`platform-analytics-csv.ts:50`, `PrintExportDialog.tsx:36-42`, `studentsCsvExport.ts:17-19` delegation, `batchLink.js:36`, the six stub-doc sites, `user-registration.md:355/:389`, `admin-session-governance.*` docblocks)
- [x] Structure check: `plan.md` contains Overview+decisions (§1), Data Models (§3), API Contracts+SDL+permission matrix (§4), Services signatures+concurrency assessment+journey design (§5, incl. §5.13–§5.15), UX/Nav no-UI ruling (§8), Security/Tenancy mitigations (§9)
- [x] Truncation check: all four artifacts end on complete sentences/rows

**Verdict: Plan passes all AGENTS.md rules for affected layers (post-fix).**

---

## Lessons for Future Plans

- **Verify delegation chains before naming "call sites"** — three of six CSV citations were upstream delegation calls, not the cell builders; the real builder (`platform-analytics-csv.ts:50`) was invisible until the call graph was traced.
- **"Already shipped" checks must precede CREATE decisions** — the plan nearly created a second `neutralizeCsvFormulas`; grep for the behavior (`formula`, `CWE-1236`, the trigger regex) before designing any helper.
- **Test-environment topology is a design constraint** — an in-memory limiter's process placement (dev-server vs test-process) determines whether `clearRateLimitStore()` can isolate anything; harness-bypass posture must be designed WITH the feature, not patched after flakes.
- **Package defaults can invalidate an AC** — `batchMax = 0` (unlimited) made "server cap ≥ client default" unsatisfiable; pin ACs to values you can set, not defaults you assume.
- **Counting semantics must be stated in static locks** — file counts vs line counts vs occurrence counts vs comment-matches differ wildly; the lock must pin the method, not just the numbers.

---

## Traceability

**Plan files modified:**
- `specs.md` — header reconciliation (b) CSV truth + sql.raw sites; §1.3 public-ops phrasing; S5 slice; REQ-010 AC3; REQ-020 AC2 (census home/semantics); REQ-030 AC3 (extraction scope); REQ-050 AC7 (harness bypass); REQ-070 AC4 (brittle count removed); REQ-080 AC1 (10-site census); §8 REQ-011/REQ-030 artifacts.
- `plan.md` — Decision 3 (explicit client batchMax); §5.5 (`ctx.t("authTranslations")`); §5.7 (extraction, 3 builders, delegation chains); §5.12 (export-keyword); §5.13 batch-cap row; §5.14 + NEW §5.15 census; testing table auth-limiter row; §10 rollout note.
- `tasks.md` — 1.3 (client `batchMax: 10` in Files); 2.2 (bypass mirror); 2.2.SEC; 2.3 (in-process suite, ordering proof, `authTranslations`); 2.4 (Files list + export); 3.1 Lock (a)/(b) + 3.1.SR (census + semantics + sql.raw sites); 3.4 (extraction scope, docblock, delegation note) + 3.4.QL/TE/SR; 5.1 (six more doc sites).

**Outcome knowledge base updated:**
- This report saved as: `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/plan-review-R1.md`

## Next Steps

- [x] Plan files patched (no commit — implementation has not started; commit with the first implementation change set per the skill's "do NOT push until implementation starts")
- [ ] Proceed to implementation (Task 0: baseline)
- [ ] OR: run another review round if the plan is materially edited later (increment R2)
