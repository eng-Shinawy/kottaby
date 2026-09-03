# Sandbox #2 Verification — Close-Out Outcome (DEV3-004)

**Plan:** ai/plans/sprint_1/dev3-004-session-creation-lifecycle-scheduled-sta/
**Branch:** `feat/dev3-004-session-creation-lifecycle-scheduled-sta` @ `a14c61c` (HEAD never moved; sandbox initially sat on `main`, re-checked out at session start)
**Session span (worklog):** V-1 → V-2a/V-2b/V-4 → F-1 → R5 (SEC/TB/FE) → F-3 → R6 → F-4 → R7 → F-5 → R8 → F-6 → R9 → R10 → F-7 (this file)
**Nature:** doc-only close-out. No source code changed by F-7; nothing committed/pushed in this session.

---

## 1. Session Purpose

Re-verify the COMPLETE DEV3-004 plan (session creation → lifecycle → scheduled-start, incl. DEV3-005 dispute pair / DEV3-012 dual-confirmation+sweeper evolution) in a **freshly re-provisioned sandbox** — a full independent replay of the plan's verification battery from scratch, followed by review waves until convergence, a golden-path browser run on real service-seeded data, and knowledge propagation. The plan itself was NOT re-opened; the session verified it end-to-end at HEAD + a fix set for drift introduced by post-plan evolution (DEV3-005/012/013).

## 2. Environment Provisioning Facts

- **PostgreSQL 17.5 embedded**, up at `127.0.0.1:5432` throughout the session.
- **Databases:** `kottaby_db` (dev) and `kottaby_test` (test), both schema-pushed.
- **Env files:** `.env` / `.env.test` written by provisioning; tests run via `bun run test:db:sequential`, `bun run test:graphql`, `bun run test:ui:components`, and the `.env.test` direct-invocation form for the service suite (with the documented `KOTTABY_TEST_RUNNER_OK=1` runner-guard bypass).
- **Standard demo seed** applied. Seed-cast gap (not a service defect): `teacher@draftacademy.local` (users.id=2) had no `teacher` role-child row and the demo student (users.id=4) held only `balance_trial=1` — fixed in the F-2 seeding approach only (teacher row inserted `isApproved=true`; paid lanes topped to 1 via `StudentRepository.incrementLane`), mirroring journey-fixture patterns. DB state after F-2 is mutated by design (documented in the F-2 worklog entry).
- **Sandbox constraints:** 4 GB RAM, no swap, 2 vCPU — one environment-caused tsgo OOM incident (V-1 §4), resolved by memory pressure clearing, no config change.
- **Provisioning artifacts to keep out of any commit:** working-tree `tsconfig.json` rewrite (adds `.next-dev` type includes; the committed version is biome-format-clean) and biome CLI drift (node_modules 2.5.11 vs bun.lock 2.5.10 → schema-version "info" only).

## 3. Baseline (V-1 — phase0-baseline-sandbox2-outcome.md)

| Gate | Fresh result | Classification |
|---|---|---|
| `bun tsgo` | exit 0, 0 errors | exact match with the plan's 7.4 final-gate reference |
| Biome `check .` | 3 errors + 1 info | 2 format-only errors = DEV3-013 wallet files (post-plan branch growth: `TeacherWalletContainer.tsx:439`, `TeacherWalletContainer.suite.tsx`); 1 = provisioning `tsconfig.json` rewrite; info = CLI-version schema drift. **Zero dev3-004-attributable diagnostics.** |
| ESLint (7.4-verbatim, cacheless) | 1 error / 0 warnings | `sonarjs/prefer-specific-assertions` @ suite:350 — same DEV3-013 file. |

All three classifiable deltas were subsequently FIXED in F-1 (biome `check --write` on exactly the two DEV3-013 files + the assertion-equivalent `toHaveLength(2)` swap). `tsconfig.json` deliberately left as provisioning-owned.

Intake artifact verification (V-1 §6): plan-review rounds 1+2 present, round 2 = gate PASS; `final-outcome.md` = "PLAN COMPLETE"; `tasks.md` = 122 `[x]` / 0 open; deferred glyph gate = 4 (legend-only, zero item statuses).

## 4. Test Battery — Final Numbers Per Layer

| Layer | Command | Final result |
|---|---|---|
| DB repo | `bun run test:db:sequential` | **117 pass / 0 fail** / 674 expects (was 113/4 — F-1 refreshed the 4 stale source-scan pins in `session.repository.test.ts`) |
| Services | `bun --env-file=.env.test test backend/services/classes/session-lifecycle.service.test.ts --timeout=60000` (+ `KOTTABY_TEST_RUNNER_OK=1`) | **118 pass / 0 fail** across the layer; the session-lifecycle suite itself **55 pass / 0 fail** / 683 expects after F-4's dynamic-import pin |
| GraphQL | `bun run test:graphql` | **66 pass / 0 fail** / 427 expects / 7 files (was 65/1 — F-1 updated the stale 49-commits-old `warning-surfacing` 12-field mutation inventory pin) |
| UI components | `bun run test:ui:components` | **137 pass / 0 fail** / 30 skip / 1159 expects + 1 snapshot |
| Journeys | `bun test test/workflows` | **16 pass / 0 fail ×2 runs** (J1 happy-path 10/179 + J2 denials 6/93; re-run twice per V-2b, not re-run after comments-only edits with proven unchanged runtime surface) |
| Types | `bun tsgo` | 0 errors |

## 5. Browser Golden Path (F-2) — PASS

- **3 real booked sessions seeded through the REAL `SessionLifecycleService.createSession` production path** (script `download/f2/seed-sessions.ts`, per-run unique idempotency keys): 399 (intent hifz, **held on the trial lane — trial-first ladder proven**), 400 (hifz lane), 401 (tajweed lane); all scheduled, fee=25.00, `fee_held=true`, 24h confirmation deadlines; 3 idempotency claims; post-seed lanes 0/0/0.
- **Teacher flow (AR UI, real browser 1440×900):** login → `/teacher/sessions` renders all 3 rows (chips, fee "25.00 EGP", deadline, actions) → Start on 401: chip scheduled→in-progress **without reload** → Complete: chip completed + teacher stamp + pending-student-confirmation pill, snackbar captured → Cancel on 400 with reason: hold-release dialog copy, 0/500 counter, chip cancelled + reason persisted.
- **Student flow:** logout → login → `/student/sessions` shows the same 3 sessions → confirm on the completed card: snackbar "تم تأكيد الإنجاز وتم تحويل الرسوم المحجوزة إلى المعلم." + student stamp.
- **End-to-end money proof:** teacher wallet (id=22) balance=25.00, total_earning=25.00, one `teacher_transaction` type=earning amount=25.00 — the **dual-confirmation wallet credit landed end-to-end**.
- Oracle-safety bonus: 6 residue session rows from prior test users leaked into neither participant list. Zero console page errors; dev.log zero `[ERROR]` lines.
- One LOW non-blocking observation (not reproducible, not on pages under test): a LoginPage hydration attribute-mismatch logged when `/login` loads while a stale auth state is being torn down — recorded as a follow-up suggestion, no functional impact.
- Evidence: `download/f2/` (gitignored) — `f2-teacher-rows.png`, `f2-teacher-started.png`, `f2-teacher-completed.png`, `f2-teacher-cancelled.png`, `f2-student-rows.png`, `f2-student-confirm.png`, `seed-sessions.ts`.

## 6. Review-Wave Trajectory (R5 → R10): 6 → 3 → 2 → 1 → 0 → 0

| Round | New findings (blocking) | Disposition |
|---|---|---|
| R5 (SEC+TB+FE) | 6 (0) | All docs/pin-honesty drift from DEV3-012/013 evolution: stale header claims, false AGENTS.md "zero wallet writes" bullet, stale-positive import pin, plan-artifact comment refs, DEV3-013 format/assertion deltas → **F-3** fixed all 6 across 7 sanctioned paths (comments-only proven executable-identical by dual method; import pin rewritten fail-closed honest) |
| R6 | 3 (0) | oxlint-disable contradiction → **D11** (F-4); service.test pin misses dynamic imports → **F-4** fail-closed `\bimport(/\brequire(` absence pin (+1 case, 55/0); let-scan statement-position caveat → recorded |
| R7 | 2 (0) | start-after-deadline escrow gap → **D12** (F-5); completed-but-unconfirmed release path (INFO) → **D13** (F-5). All fix-verification checks PASS |
| R8 | 1 (0) | arbitration-Complete no-credit asymmetry (INFO) → **D14** (F-6) |
| R9 | 0 (0) | Earned clean round — continuity 3/3 PASS; core lifecycle re-read at resolver+service+repo+SQL depth, every candidate resolved clean or onto exact RECORDED matches |
| R10 | 0 (0) | Confirmation round — R9 verdict CONFIRMED; recorded sites verbatim; fresh probe set (fees, enums, schema, documents, SDL recount, pothos inputs, defect census) clean |

Each round wrote `outcome/round-R<N>-review-outcome.md`. Continuity gates held from R7 onward: plan-artifact regex = 0 hits in the 6 cleaned code files; dynamic-import pin intact (55 `test(` declarations); deferred grep gate = 4.

## 7. Committed Fix-Set File List (13 files)

Working tree = 14 modified files − `tsconfig.json` (provisioning artifact, excluded) = **13 files ready to commit**:

1. `backend/db/repo/classes/session.repository.ts` — comment-only docblock cleanup + plan-artifact removal (F-1 A4; non-comment changed-line scan = 0)
2. `backend/db/test/repo/classes/session.repository.test.ts` — refreshed stale source-scan pins A1–A3 (F-1)
3. `backend/graphql/mutation/classes/session-lifecycle.mutation.ts` — clean-comments sweep (F-3)
4. `backend/graphql/query/classes/session-lifecycle.query.ts` — clean-comments sweep (F-3)
5. `backend/services/AGENTS.md` — honest session-lifecycle bullet (wallet credit is the only cross-surface write; F-3)
6. `backend/services/classes/session-lifecycle.service.ts` — header honesty rewrite + comment sweep (F-3)
7. `backend/services/classes/session-lifecycle.service.test.ts` — 13-entry specifier allowlist + barrel-members pin + dynamic-import absence pin (F-3/F-4)
8. `frontend/graphql/test/warnings/warning-surfacing.test.ts` — 12-field `KNOWN_LIVE_MUTATION_FIELDS` SDL inventory pin (F-1 B)
9. `frontend/views/student/sessions/StudentSessionsContainer.tsx` — clean-comments sweep (F-3)
10. `frontend/views/teacher/sessions/TeacherSessionsContainer.tsx` — clean-comments sweep (F-3)
11. `frontend/views/teacher/wallet/TeacherWalletContainer.tsx` — 1-line indentation fix (F-1 C1)
12. `test/ui/components/teachers/teacher-wallet/TeacherWalletContainer.suite.tsx` — biome rewraps + assertion-equivalent `toHaveLength(2)` (F-1 C1/C2)
13. `ai/plans/sprint_1/dev3-004-session-creation-lifecycle-scheduled-sta/deferred-items.md` — ledger rows D11–D14 + addenda (F-4/F-5/F-6)

**Excluded from the commit:** `tsconfig.json` (provisioning rewrite) and the untracked plan-doc outcome files (`phase0-baseline-sandbox2-outcome.md`, `round-R6..R10-review-outcome.md`, this file).

## 8. Deferred Additions (D11–D14, one line each)

- **D11** — inline `// oxlint-disable-next-line no-await-in-loop` at `session-lifecycle.service.ts:854` (the sweeper refund loop; the codebase's ONLY disable comment) contradicts `backend/services/AGENTS.md` + `docs/quality/linting-rules.md` — future backend-services refactor (recursive-helper pattern; NOT Promise.all).
- **D12** — `startSessionOnce` predicate (`session.repository.ts:240-253`) lacks a `confirmation_deadline` term, so a deadline-passed scheduled row can be legally started before the cron sweep ticks and then permanently escapes the sweep — DEV3-012 follow-up (fuse the deadline guard + add the start-vs-expired test arm).
- **D13** — Completed rows with `fee_held=true` and no student confirmation have no timeout/arbitration release path (cancel/dispute cover scheduled/started; sweeper covers scheduled; admin queue lists disputed only) — escrow-lifecycle design ticket.
- **D14** — arbitration-Complete (`resolveDisputeCompleteOnce`, `session.repository.ts:419-439`) flips `fee_held=false` with NO teacher wallet credit and NO ledger row while the ordinary complete→confirm path credits the same fee — escrow-lifecycle design ticket (D13 family).

Deferred grep gate: `grep -c "❌\|⚠️" deferred-items.md` = **4** — legend + quoted-grep-citation glyphs only; D1–D14 all use the neutral ⏸ marker (REQ-083 item-status gate clean).

## 9. Knowledge Propagation Performed (F-7)

The session's one recurring battle-tested gotcha (3+ occurrences): **source files covered by static source-scan pin tests drifted out of sync when later plans evolved them** — DEV3-012 evolved `session.repository.ts` without updating DEV3-004's static pins (V-2a/F-1 found 4 stale db pins, 113/4 red), DEV3-012 added an `oxlint-disable` contradicting `backend/services/AGENTS.md` (D11), and the warning-surfacing SDL inventory pin went 49 commits stale (A1, `test:graphql` 65/1 red).

Permanent rule added to `.agents/instructions/tests.instructions.md` (§ Quality, 2 lines, global style, no plan references):

> - When a source file is covered by static source-scan pin tests (count pins, allowlist pins, comment-hygiene pins), ANY change to that file must update those pins in the SAME change - a stale pin asserts a false contract and hides real drift
> - Dynamic `import()`/`require()` escape hatches must be pinned out wherever a static specifier allowlist exists - a dynamic specifier bypasses `from "..."` scans entirely

No other AGENTS.md/instructions files touched — the session's remaining learnings are already propagated via the plan's Phase-7 docs and the D11–D14 ledger rows.

## 10. Completion Statement

**The DEV3-004 plan REMAINS COMPLETE.** It was re-verified end-to-end in a fresh sandbox at HEAD `a14c61c` + the 13-file fix set: all gates and test layers green at final numbers (§3–§4), browser golden path PASS on real service-seeded sessions with the dual-confirmation wallet credit proven end-to-end (§5), the independent review trajectory converged 6→3→2→1→0→0 with rounds R9/R10 clean (§6), and every residual finding is owned by a deferred-ledger row with a target task (§8) — the item-status gate is clean at 4 legend-only glyph hits. Nothing unexplained or unattributable remains in the tree. The fix set is ready to commit (excluding the `tsconfig.json` provisioning artifact and untracked plan docs); no commit/push was performed in this session.
