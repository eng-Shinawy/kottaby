# Deferred Items Ledger

**Feature:** `Production Launch Checklist Execution`
**Plan:** `ai/plans/milestone_4/production_launch_checklist_execution`
**Ticket:** `docs/planning/TICKETS.md:3029-3059` (Milestone 4 · Dev 3 · 5 SP — the final gate before opening the platform)
**Executed checklist:** `docs/planning/PRODUCTION_READINESS.md` (156 §1–§8 rows + 17 §9 items; Launch Gate rule at `:12`)
**Created:** 2026-10-08 · **Seeded:** in the tasks-writing session per REQ-000 AC-2 (specs §2.2 D1–D11 canonical + plan-introduced D12–D17)

---

## Purpose

This ledger tracks all work deferred from this plan. These are **deferred-by-design items with launch sign-off semantics, not unresolved work**: each row names its disposition target (backlog ticket, sign-off note, or launch condition) and its owning party, so nothing is silently dropped and nothing is built twice. Per the exemplar convention, every row is a **✅ resolved-pointer** — the final gate is `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0. The launch-blocking question — "does every checklist waiver carry a named owner + signatory?" — is enforced by the gate's `computeVerdict` (tasks.md 4.4, REQ-001 AC-4 / REQ-011 AC-4), never by ❌/⚠️ rows here.

---

## Ledger Table

| ID | Deferred Item | Source | Disposition Target / Owner | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Booking-time availability re-assertion gate (row 3.3.3) — as-built, the directory-level NOT-EXISTS exclusion (`teacher.repository.matching.helpers.ts:129-142`) is the MVP availability gate | specs §2.2 D1 · REQ-005 AC-3 | Matching-flow backlog ticket (Dev 3 on-demand matching, `docs/planning/TICKETS.md:1457`) + ☐ WHY sign-off on row 3.3.3 | ✅ resolved-pointer (waived-with-sign-off) | research-03 gap 1 | Waiver note must record that journey J4 (`in-session-lock-release.journey.test.ts`) deliberately books an in-session teacher today and must be updated if a gate ever ships |
| D2 | B.16 `teacher.request_preference` runtime intake (queue / reject / offer_alternatives) | specs §2.2 D2 · REQ-010 AC-5 | Row 8.26 checks the schema half ✅; the runtime half is ☐ WHY waived-with-sign-off → matching/intake backlog | ✅ resolved-pointer (waived-with-sign-off) | pgEnum `backend/db/schema/enums.ts:271` + column `backend/db/schema/teachers/teacher.ts:54` + TS mirror exist | Pre-existing deferred work (milestone-2 ledger lineage); the row is checked for schema, the decision's runtime half is honestly waived |
| D3 | Sustained production-scale load program (100+ user / 1-hour production soak; 100+ teacher matching at production scale; remediation) | specs §2.2 D3 · plan design D4 · REQ-008 AC-5 | 8-SP sibling ticket (`docs/planning/TICKETS.md:2911`); production-scale runs recorded as launch-drill evidence rows or signed waivers (tasks 4.2) | ✅ resolved-pointer (drill-conditional) | research-00 gap 1; research-09 | This ticket ships the Bun-native tooling (`scripts/load/`) + records a scaled dev baseline (task 2.14); the sustained program is the sibling's, never absorbed |
| D4 | Student-journey chained workflow (`test/workflows/students/student-full-journey.journey.test.ts`) | specs §2.2 D4 | Sibling M4 ticket (Dev 1, `docs/planning/MILESTONE_PLAN.md:358`); the §9 ticket-state audit (task 3.3) dispositions its state — landed or waived-with-sign-off | ✅ resolved-pointer | research-00 row 1 (PARTIAL) | Legs exist across registration / subscription / dual-confirmation / parent journeys; the single chained artifact is the sibling's — never silently passed at the audit |
| D5 | GraphQL depth/complexity limiting | specs §2.2 D5 · REQ-006 AC-7 | ☐ WHY + sign-off on the §4 hardening row; security-hardening backlog | ✅ resolved-pointer (waived-with-sign-off) | only the 2MB body cap exists today (`backend/lib/gateway/transport-guard.ts:49`) | Beyond any checklist row — hardening, not launch-blocking |
| D6 | DataLoader retrofit for N+1 batching | specs §2.2 D6 | Rejected by design: flat-projection kept (`backend/graphql/pothos/builder.ts:15-17`, plugin intentionally NOT loaded); the N+1 oracle is the query-count harness (task 2.14, REQ-008 AC-3) | ✅ resolved-pointer (rejected) | plan §5 C12; research-09 | Never build without a failing query-count oracle first |
| D7 | Operator-side scheduler arming evidence (systemd timers / crontab / platform scheduler for the four cron routes + the backup timer) | specs §2.2 D7 · REQ-012 AC-1 · REQ-009 AC-3 | Ops sign-off lines in §7/§9 + `docs/ops/launch-arming-runbook.md` (task 4.3); live envelopes recorded by `scripts/launch/verify-cron.ts` | ✅ resolved-pointer (launch condition) | research-03 gap 6; research-08b gap 1 | Environment-side, not repo work; nothing in-repo proves anything calls the routes today — arming evidence is a launch condition |
| D8 | `test:simulate` dangling package script (`package.json:40` targets the empty `test/simulate/` directory) | specs §2.2 D8 | Remove-or-populate decision RECORDED: **REMOVE** — superseded by the `scripts/load/` harness; owner: task 2.14 | ✅ resolved-pointer (decided) | research-10 row 17 | The S8 load harness fulfills the simulation intent; the dangling script is retired in task 2.14 |
| D9 | DR plan's own deferrals (Neon PITR D-001, scheduled automation D-002, off-site upload D-003) | specs §2.2 D9 · REQ-009 AC-4 | Re-confirmed as §7 sign-off lines at the DR drill (task 4.1) — not re-opened | ✅ resolved-pointer (sign-off note) | `docs/ops/disaster-recovery.md` deferral registry | Ratified at the DR plan; launch sign-off re-confirms each with a named signatory |
| D10 | DB-level session-status guard trigger (INV-S1/S2 — a `custom_6-session-status-guard`-style trigger permitting only the legal matrix edges) | specs §2.2 D10 · plan design D2 · REQ-007 AC-2 | Signed exception on rows 5.1.1/5.1.2: app-layer guarded-UPDATE enforcement accepted; the trigger stays deferred | ✅ resolved-pointer (waived-with-sign-off) | research-05 gap 1 — zero `CREATE TRIGGER` touches `session` across `backend/drizzle/*/migration.sql`; 5×5 sweep `session-lifecycle.enforcement.test.ts:164-193` + INV-S1/S2 journey pins `session-state-machine.journey.test.ts:426,434` | A pre-launch trigger on the hottest table risks blocking legitimate guarded transitions |
| D11 | `scripts/escrow-e2e/` stale foreign-machine harness (hardcodes `/home/z/my-project`, `leg1-booking.sh:4-7`) | specs §2.2 D11 · REQ-004 AC-6 | Launch condition: NEVER cited as §2 evidence (the AC-1 journeys supersede it); retire-or-re-home = post-launch housekeeping note owned by Dev 3 | ✅ resolved-pointer (launch condition) | research-02 gap 4 | Superseded by `test/workflows/billing/` + `test/workflows/sessions/` |
| D12 | CSRF token mechanism (row 4.2.4's planning wording) | plan design D3 · REQ-006 AC-3 · REQ-002 AC-10 | Rejected-for-launch: shipped posture pinned (HttpOnly `SameSite=Strict` cookie `backend/lib/auth/cookies.ts:160` + POST-only 405 `transport-guard.ts:37` + CORS allowlist + CSP `frame-ancestors 'none'`) and the row re-worded; a token retrofit stays hardening backlog | ✅ resolved-pointer (rejected) | research-04 harness rec 4 | A token retrofit before launch adds risk, not safety |
| D13 | Scheduled parent-link expiry sweep wiring (row 5.5.6 / B.14) | plan design D5 · REQ-007 AC-5 · REQ-012 AC-5 | Signed waiver: on-demand `ops:sweep-link-requests` / `ops:remind-link-requests` (`package.json:66-67`) is the launch posture (the runbook states the cadence, bounding the re-request lockout window); scheduled wiring stays with the canonical doc's own cron-stream backlog ticket (`docs/parents/parent-link-request.md:87,123`) | ✅ resolved-pointer (waived-with-sign-off) | `parent-link-request.chaos.test.ts:801` — lockout lifted by running the sweep | All four cron routes are externally triggered; a fifth scheduler integration at launch adds operational risk with no behavioral gain |
| D14 | Per-account lockout + distributed login limiter (via the installed-but-unused `@upstash/redis`) + login-specific per-IP limiter | plan §8/§10 · REQ-006 AC-2/AC-7 | ☐ WHY + sign-off on the §4 hardening row; security-hardening backlog | ✅ resolved-pointer (waived-with-sign-off) | the shipped `loginAccountLimiter` (task 2.6) is in-memory per-instance, fail-open — same posture as the gateway limiter (`backend/lib/ratelimit.ts:125-127`); transport-level IP throttling is the EXISTING gateway-wide per-IP limiter (`app/api/graphql/rate-limit.ts:56`), and the GraphQL Context exposes no client IP (`backend/graphql/gqlContextFactory.ts:49-99`) — a login-specific per-IP limiter would require an undeclared context change | Distribution + the login-specific per-IP tier are post-launch hardening |
| D15 | CA-verified TLS for the DB connection | REQ-006 AC-7 · plan §10 | Signed launch note: `rejectUnauthorized: false` posture recorded (`backend/db/client.ts:157`, task 2.8 test); CA-verified TLS stays hardening backlog; production `DATABASE_URL` MUST carry `sslmode=require` (launch condition, REQ-012 AC-4) | ✅ resolved-pointer (waived-with-sign-off) | `backend/db/client.ts:42-46` | The `sslmode=require` condition is enforced at launch; CA verification is beyond the 5-SP envelope |
| D16 | `permission` authScope placeholder (`backend/graphql/pothos/builder.ts:148`, always-true) | plan §10 · REQ-006 AC-7 | Signed launch note at §4 sign-off: admin surfaces use role/superAdmin scopes today; wiring the placeholder is post-launch hardening | ✅ resolved-pointer (sign-off note) | `builder.ts:148` | Theoretical exposure recorded honestly — never silently passed |
| D17 | `kottaby.users_delete_guard` GUC opt-out for the `prevent_users_delete` trigger (row 1.1.1 / plan design D1 / C8) | plan design D1 + C8 · REQ-003 AC-1/AC-2 · REQ-012 AC-1 | Signed launch note: the guard is ON when the GUC is unset (production default); the test-path opt-out is connection-time only — the pg Pool startup-options packet at `backend/db/client.ts:168` + the PGlite init pin at `backend/db/pglite-pool.ts:199`, gated on `TEST_CI`/`TEST_SERVER` with the `app/api/graphql/rate-limit.ts:34-48` production fail-fast guard; the arming runbook (`docs/ops/launch-arming-runbook.md`, task 4.3) carries the production-DB posture line: the opt-out value is NEVER set in any production connection string or environment | ✅ resolved-pointer (sign-off note) | GUC-with-missing-ok idiom already in the migration corpus (`backend/db/migration/2-functions.sql:4`); provisioning-seam audit: `bun run db migrate` is the shared prod/CI path (`scripts/dbActions/cli-entry.ts` → `backend/db/scripts/migrate.ts:24`) and the CI test DB is created by the `postgres:16` service container (`.github/workflows/ci.yml:213,280,349`) — hence the connection-time client pins, zero test-helper edits | An attacker with SQL access could `DROP TRIGGER`/`ALTER TABLE … DISABLE TRIGGER` on any existing immutable-table trigger — the GUC adds no material weakening; probe proof: task 2.1 (`set_config('kottaby.users_delete_guard','on',true)` → RAISE) |

---

## Status Values

- ✅ **Done** — Item completed and verified (with reference to outcome file or commit)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on

> **Resolved-pointer variants used above (exemplar convention):** `✅ resolved-pointer` (deferred-by-design, named owner), `(waived-with-sign-off)` (a ☐ WHY checklist row carrying owner + signatory), `(rejected)` (ruled never-build), `(launch condition)` (evidence the launch gates on), `(sign-off note)` / `(decided)` / `(drill-conditional)`. All count as resolved for the final gate.
>
> Row-scoped gate note: the legend above intentionally contains the ❌/⚠️ symbols; the final-gate grep is row-anchored (`^\s*\|.*(❌|⚠️)`) and must count ZERO matching ledger-table rows.

## Waivers Pending Launch Sign-Off

The ledger table above is enforcement-scoped (resolved-pointers only). The **launch-blocking waiver semantics** live in the executed checklist + the launch report and are enforced by `computeVerdict` (tasks.md 4.4): `VERDICT: PASS` iff zero FAIL rows AND every ☐ WHY waiver carries a named owner + signatory (`PRODUCTION_READINESS.md:12`).

Checklist rows expected to carry ☐ WHY at sign-off, each mapped to its ledger row: 3.3.3 booking gate (D1) · 8.26 runtime half (D2) · §4 hardening rows — depth/complexity, per-account lockout/distributed limiter/login-specific per-IP limiter, CA-verified TLS (D5/D14/D15) · 5.1.1/5.1.2 DB-trigger exception (D10) · 5.5.6 on-demand sweep posture (D13) · production-scale load runs if not drilled (D3) · scheduler-arming + backup-timer evidence lines (D7) · DR deferral re-confirmations (D9) · the users-delete-guard GUC opt-out posture note (D17). Product-Owner sign-off inputs (not waivers): interim session fee `"25.00"` EGP + provisional `RE_EVALUATION_FEE = "100.00"` (REQ-002 AC-8) — frozen by the task 2.12 `RUBRIC_PASS_THRESHOLD` pin plus the existing green constant pins cited run-and-record.

**What the final gate treats as PASS:** (a) this ledger's row-scoped grep = 0; (b) `docs/planning/launch-report-<UTC-stamp>.json` `VERDICT: PASS` — zero FAIL rows, every waiver signed; (c) §9 filled by the five named humans (tasks.md 4.5). Anything else blocks launch.

## Usage Guidelines

- Add a row (next `D<id>`) when a task discovers work owned by another ticket/task — never defer silently.
- Update status only with a verification reference (outcome file / review round / commit).
- Task outcome files MUST reference this ledger when deferring or resolving ("Resolved D13 (see deferred-items.md)").
- Do NOT renumber specs §2.2's D1–D11 — cite them verbatim; new items continue at D18+ (D17 is taken by the users_delete_guard GUC opt-out note).

## Enforcement

The final quality gate (tasks.md 5.1) MUST verify:

```bash
grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_4/production_launch_checklist_execution/deferred-items.md
# Expected: 0
```

**Exit criteria:** the plan cannot be marked complete if any ❌/⚠️ ledger row remains. This file intentionally holds NONE — deferred-by-design items are resolved-pointers; waiver/signature enforcement is `computeVerdict`'s job, and an unsigned waiver is a launch FAIL, never a ledger state.

## Numbering Reconciliation (specs.md canonical ↔ plan.md design rulings)

specs.md §2.2's **D1–D11 are canonical** and are kept verbatim above. plan.md §1's "Key Design Decisions" reuse the D1–D7 labels for DESIGN RULINGS with different content — mapping into THIS ledger:

| plan design ruling | Ledger mapping |
|---|---|
| design D1 — `prevent_users_delete` trigger (GUC-gated) via the authored-source custom-migration lane + the test-path client opt-out pins | In-scope work (tasks.md 2.1) — not a deferral; the GUC opt-out posture itself is the **D17** signed launch note |
| design D2 — DO NOT add a session-status DB trigger | **D10** |
| design D3 — account-keyed login limiter ships; CSRF stays cookie-posture | In-scope work (tasks.md 2.6/2.7) + **D12** (token non-build) + **D14** (login-specific per-IP tier folds into the hardening row) |
| design D4 — Bun-native load tooling; production-scale runs are launch-drill items | **D3** |
| design D5 — parent-link on-demand posture; scheduled wiring stays deferred | **D13** |
| design D6 — zero GraphQL schema/UI changes | In-scope ruling — no ledger row |
| design D7 — launch report at `docs/planning/launch-report-<stamp>.json`, redacted | In-scope ruling — no ledger row |
| design D7a/D7b — process-lock exemption; INV-B6 existing wire coverage | In-scope harness edits (tasks.md 1.4 / 2.11) |

**D12–D17 are THIS ledger's additions** for plan-introduced deferrals that specs §2.2 gives no D-pointer to (CSRF tokens, scheduled parent-link wiring, per-account lockout/distributed limiter + login-specific per-IP limiter, CA-verified TLS, the `permission` authScope placeholder, the `kottaby.users_delete_guard` GUC opt-out signed note) — each is demanded as a "☐ WHY + ledger pointer" or signed launch note by REQ-006 AC-7 / REQ-007 AC-5 / REQ-003 AC-1 / plan §10, so each needs a row to point to.

## Anti-Patterns (What NOT to Do)

❌ **Don't renumber or reword specs' D1–D11** — later tasks and the checklist waiver notes cite these IDs verbatim.
❌ **Don't mark a resolved-pointer without its disposition target + named owner** — a pointer without an owner is a silent drop.
❌ **Don't record a waiver without a signatory** — that is a launch FAIL (computeVerdict), not a ledger state.
❌ **Don't treat arming or drill evidence as repo work** — D7/D3/D9 are environment-side sign-off items; the repo ships tooling + records evidence.
❌ **Don't reopen ratified deferrals** (D9) without a new plan; re-confirmation at sign-off is the sanctioned path.
❌ **Don't absorb sibling tickets** (D3 load program, D4 student-journey chain) into this 5-SP ticket — the gate audits their state, it never absorbs their scope.

---

## Related Documents

- Specs: `ai/plans/milestone_4/production_launch_checklist_execution/specs.md` §2.2 (D1–D11) · Design: `plan.md` §1 (design rulings D1–D7) + §16 (ledger exit criteria)
- Tasks: `ai/plans/milestone_4/production_launch_checklist_execution/tasks.md` — task 0.1 (seed verification), 4.4 (`computeVerdict`), 5.1 (enforcement)
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
