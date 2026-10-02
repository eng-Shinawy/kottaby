## ✅ Complete — Session Report & Homework Infrastructure

Implemented per plan: `ai/plans/milestone_1_core_domain_mvp/session-report-homework-infrastructure/`
Close-out: `ai/plans/milestone_1_core_domain_mvp/session-report-homework-infrastructure/outcome/final-outcome.md`
Canonical reference: `docs/sessions/session-report-homework.md`
Integration: PR #86 (`feat/session-report-homework` → `main`) — merge gated on the branch's required status checks.

### What was delivered

- **Schema arbiters**: `reports_session_id_unique` + `home_work_session_id_unique` (push-only migration; introspection-verified 5/5 in `outcome/1.2-outcome.md`) — one report / one homework per session
- **Canonical types**: `backend/types/classes/report.types.ts` (+ submit-input family), `backend/types/classes/home-work.types.ts` (NEW), `session-notification.types.ts` wave types
- **Repositories**: `report.repository.ts` (insertReport / findBySessionId, tx-last), `home-work.repository.ts` (4 methods incl. guarded one-shot `gradeHomeWorkOnce` — `UPDATE ... WHERE current_grade IS NULL AND revision_grade IS NULL`)
- **Guarded service**: `session-report.service.ts` — exact pipeline: pre-DB validation → governance re-assertion → `FOR UPDATE` gate → atomic report+homework co-creation in ONE `withTransaction` → prior-grade one-shot routing → in-tx notifications → publish-after-commit
- **Read surface**: participant-only `getSessionReport` / `getSessionHomework` — silent, zero writes, historical rows survive governance flips
- **Notification seam**: `session-report-notification.service.ts` — one wave-context read, recipient-locale, parent iff linked, names-only copy, publish post-commit
- **GraphQL surface** (Pothos): mutation + 2 nullable queries + 4 closed inputs + enum registration; codegen drift ZERO (md5-verified); typed documents `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts`
- **i18n**: en/ar — 9 error keys + 3 notification slots (parity suites: errors 18 pass, notifications 105 pass)
- **Knowledge artifacts**: `docs/sessions/session-report-homework.md` (canonical, house style) + 5 layer AGENTS.md updates + `docs/sessions/session-lifecycle.md` INV-S7/S8 rows → "Shipped"

### Acceptance criteria status

| Criterion (issue body) | Status |
|---|---|
| Reports & home_work infrastructure: repositories, canonical types, guarded service, GraphQL surface, notification seam | ✅ final-outcome §Traceability REQ-010/011/012/050–053 |
| C.4 — no `reports.teacher_id`; teacher identity solely via `reports.session_id → session.teacher_id` | ✅ REQ-012 row: ownership gate reads the session row; input never carries server-derivable identity |
| INV-S7 — authenticated teacher + governance re-check + caller owns session + status `completed`; cancelled/disputed denied | ✅ REQ-012 + REQ-034 rows: per-status `SESSION_INVALID_TRANSITION` denials (`outcome/2.7-outcome.md` tiers 1–4) |
| INV-S8 — report + homework in ONE `withTransaction`; homework-without-report structurally unreachable; failure rolls back to zero rows | ✅ REQ-013 row: journey step 11 forced mid-tx rollback → zero rows + zero publishes |
| One report per session, race-proof — unique arbiter decides, 23505 → `SESSION_REPORT_ALREADY_EXISTS` | ✅ REQ-040/043 rows: storm ×3 deterministic (1 winner, N−1 typed conflicts) |
| INV-HW3/HW4 — first-vs-subsequent grading; grades route to prior ungraded row; each assignment graded exactly once | ✅ REQ-015 row: newest-prior-row routing; journey steps 9/10 |
| Validation pre-DB — rating 0–5, notes non-empty ≤2000, grades 0–100 | ✅ REQ-016 row: guards suite boundaries + fuzz (46 pass) |

### Quality gates

- Per-plan (`outcome/final-outcome.md` §Final test matrix): repo suites **169 pass / 0 fail** · services suites **217 pass / 0 fail** · schema-surface + session-sdl **41 + 20 pass** · journey **14 pass ×3** · documents contract **11 + 20 pass** · tsgo **0** / oxlint **0-0** / biome **clean** / duplicates **0 clones** · codegen drift **ZERO**
- Post-plan full-repo re-verification (recorded in PR #86): `test:db` **466/466** · `test:services` **802/802** · `test:graphql` **172/172** · quality-gate lifecycle **DONE** (tsgo → oxlint → biome → knip → type-aware lint → duplicates)
- Review: 4 reviewer waves + Wave-2 zero-finding verification — **zero CRITICAL/HIGH/MEDIUM**; 4 LOW fixed, 7 recorded with rationale (`outcome/6-review-waves.md`)
- Honest caveat (carried from the plan): the GraphQL wire suite is authored (1141 lines, matrix + smuggle + fuzz + byte-identity) but runner-skipped under pglite by repo design; it executes in CI with real postgres (ledger `Wire-Suite-CI`).

### Deferred items (D1–D5 + Wire-Suite-CI, tracked in `deferred-items.md`)

- **D1** — `SurahJuzRef` 114-surah expansion → curriculum/content stream (📅 Forward)
- **D2** — Parent report read surface → parent portal (📅 Forward)
- **D3** — Teacher submit/browse UX (📅 Forward)
- **D4** — `teacher.average_rating` aggregation (📅 Forward)
- **D5** — Report amendment/void semantics → future ticket (📅 Forward)
- **Wire-Suite-CI** — wire-suite execution → CI environment (📅 Forward, environmental)

Zero ❌ blocked items — all deferrals are pre-seeded forward items owned by later tickets; the infrastructure scope of this ticket is fully delivered.

Closing as completed. 🎉
