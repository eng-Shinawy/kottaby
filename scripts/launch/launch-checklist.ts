/**
 * The launch-checklist row registry — the single source of truth mapping every
 * production-readiness checklist row (docs/planning/PRODUCTION_READINESS.md)
 * to its owning gate stage, proof modality, canonical command, and evidence
 * reference.
 *
 * Row inventory (173 total, exactly mirroring the checklist): Section 1 Data
 * Integrity & Governance 17 · Section 2 Financial & Escrow Safeguards 25 ·
 * Section 3 Real-Time Reliability 17 · Section 4 Security 16 · Section 5 State
 * Machine Invariants 34 · Section 6 Performance & Load 7 · Section 7 Disaster
 * Recovery 7 · Section 8 Decision Verification 33 · Section 9 Launch Sign-Off
 * 17 (9.1-9.5 = the five signature rows; 9.6-9.17 = the twelve final launch
 * criteria in document order).
 *
 * Row identifiers map 1:1 to the checklist: Sections 1-8 use the document's
 * own numbering; Section 9's items carry no numeric ids in the document, so
 * this registry assigns 9.1-9.5 to the five signature-table rows and
 * 9.6-9.17 to the twelve final launch criteria checkboxes (in document order).
 *
 * Modality semantics live on `LaunchModality` in
 * `@/scripts/launch/shared/launch-types`; one registry-level consequence:
 * DOC-SIGNOFF and MANUAL-DRILL rows are marked ONLY from the existence of
 * their signed entry / filed artifact — their `command` carries a human
 * verification oracle the gate never executes.
 *
 * Evidence reference conventions (repo-relative; `<run-stamp>` is the gate
 * run's `logs/` timestamp directory, substituted at execution time):
 *   • `logs/<run-stamp>/<test-path>.log` — the runner's own log capture for a
 *     single suite (`bun run test/scripts/run-test.ts <path>` writes exactly
 *     this shape).
 *   • `logs/<run-stamp>/<slug>.log` — gate-captured output for layer runners,
 *     probe CLIs, and standalone commands.
 *   • `docs/planning/launch-report-<stamp>.json` — the machine launch report a
 *     Section 9 criterion is verified from.
 *   • MANUAL-DRILL rows point at the artifact the drill must file under the
 *     plan outcome directory — those exact paths are the filing contract for
 *     the drill-execution steps (existence-checked, never auto-passed).
 *
 * Waivers: rows whose as-built posture includes a signed exception carry
 * `waiver: { why, owner }` alongside their command — the command documents
 * the as-built behavior that runs green; the waiver carries the rationale and
 * the named accountable owner (a waiver without a named owner is
 * launch-blocking). The known waiver set is exactly: 3.3.3, 4.2.1, 4.2.5,
 * 4.3.4, 5.1.1, 5.1.2, 5.5.6, 8.26.
 *
 * Commands that reference not-yet-shipped closer artifacts (new probe tests,
 * new journeys, `scripts/launch/*` / `scripts/load/*` probe CLIs) are part of
 * this registry's contract: the harness, its probes, and the gap-closing
 * suites land before the gate first executes a stage for real.
 */

import type { LaunchRow, LaunchStage } from "@/scripts/launch/shared/launch-types";

/**
 * The nine launch-gate stages in canonical execution order. The order is
 * load-bearing: the gate persists its progress as a stage literal and resumes
 * by looking the stage up in this array (`STAGES.indexOf`).
 */
export const STAGES: readonly LaunchStage[] = [
  "s1-data-integrity",
  "s2-financial",
  "s3-realtime",
  "s4-security",
  "s5-invariants",
  "s6-performance",
  "s7-dr",
  "s8-decisions",
  "s9-gate",
];

/** The checklist section each stage verifies (stage index = section number). */
const SECTION_FOR_STAGE: Readonly<Record<LaunchStage, LaunchRow["section"]>> = {
  "s1-data-integrity": 1,
  "s2-financial": 2,
  "s3-realtime": 3,
  "s4-security": 4,
  "s5-invariants": 5,
  "s6-performance": 6,
  "s7-dr": 7,
  "s8-decisions": 8,
  "s9-gate": 9,
};

/**
 * Row factories — every registry row is built through one of these so the
 * registry body below stays one line per row. `row` is the shared base; each
 * factory fixes the modality and the evidence-reference shape for its class.
 */
const row = (
  rowId: string,
  section: LaunchRow["section"],
  modality: LaunchRow["modality"],
  command: string,
  evidenceRef: string
): LaunchRow => ({
  rowId,
  section,
  modality,
  command,
  evidenceRef,
});

const suite = (rowId: string, section: LaunchRow["section"], testPath: string) =>
  row(
    rowId,
    section,
    "AUTOMATED-TEST",
    `bun run test/scripts/run-test.ts ${testPath}`,
    `logs/<run-stamp>/${testPath}.log`
  );

const gql = (rowId: string, section: LaunchRow["section"], testPath: string, logSlug: string) =>
  row(
    rowId,
    section,
    "AUTOMATED-TEST",
    `bun run test:graphql ${testPath}`,
    `logs/<run-stamp>/test-graphql-${logSlug}.log`
  );

const probe = (rowId: string, section: LaunchRow["section"], command: string, logName: string) =>
  row(rowId, section, "SCRIPT-PROBE", command, `logs/<run-stamp>/${logName}.log`);

const gate = (rowId: string) =>
  row(rowId, 9, "AUTOMATED-TEST", "bun run scripts/launch/launch-gate.ts", "docs/planning/launch-report-<stamp>.json");

const drill = (rowId: string, section: LaunchRow["section"], command: string, evidenceRef: string) =>
  row(rowId, section, "MANUAL-DRILL", command, evidenceRef);

const signoff = (rowId: string, section: LaunchRow["section"], oracle: string, evidenceRef: string) =>
  row(rowId, section, "DOC-SIGNOFF", oracle, evidenceRef);

const sig = (rowId: string, role: string) =>
  row(
    rowId,
    9,
    "DOC-SIGNOFF",
    `Verify the ${role} signature row (Name/Signature/Date) is filled in docs/planning/PRODUCTION_READINESS.md Section 9`,
    "docs/planning/PRODUCTION_READINESS.md"
  );

const drSignoff = (rowId: string, oracle: string) =>
  row(rowId, 7, "DOC-SIGNOFF", oracle, "docs/ops/disaster-recovery.md");

const waived = (base: LaunchRow, why: string, owner: string): LaunchRow => ({ ...base, waiver: { why, owner } });

// Hoisted row data — waiver rationales and drill artifacts, so waived and
// drill rows stay one line each in the registry body.

const WAIVER_3_3_3 =
  "As-built, the directory-level NOT-EXISTS exclusion (backend/db/repo/teachers/teacher.repository.matching.helpers.ts:129-142) is the MVP availability gate; booking-time re-assertion is waived-with-sign-off to the matching-flow backlog ticket (deferred-items ledger D1). The in-session-lock-release journey's deferred-restore lane deliberately books an in-session teacher today and must be updated if a gate ever ships.";
const WAIVER_4_2_1 =
  "Input validation is proven on the auth/admin surfaces (registration battery, phone/password policies, GraphQL non-null type system); exhaustive per-field fuzzing and GraphQL depth/complexity limiting are post-launch hardening (deferred-items ledger D5) — only the 2MB body cap ships today (backend/lib/gateway/transport-guard.ts:49).";
const WAIVER_4_2_5 =
  "The shipped loginAccountLimiter is in-memory, per-instance, and fail-open (backend/lib/ratelimit.ts:125-127); the distributed limiter via the installed-but-unused @upstash/redis, per-account lockout, and a login-specific per-IP limiter are post-launch hardening (deferred-items ledger D14) — transport-level IP throttling is the existing gateway-wide limiter (app/api/graphql/rate-limit.ts:56), and the GraphQL context exposes no client IP.";
const WAIVER_4_3_4 =
  "Encrypted TLS is enabled for sslmode=require / Neon DSNs (backend/db/client.ts:42-46) with the rejectUnauthorized: false posture recorded as a signed launch note; CA-verified TLS is post-launch hardening (deferred-items ledger D15). The production DATABASE_URL MUST carry sslmode=require (launch condition).";
const WAIVER_5_1_1 =
  "Terminal-state protection is enforced by application-layer guarded UPDATEs (the 5x5 enforcement sweep plus the session-state-machine journey pins); a DB-level session-status guard trigger stays deferred (deferred-items ledger D10) — a signed exception, never a silent skip.";
const WAIVER_5_5_6 =
  "Expiry is enforced at read/claim time (strict expiresAt > now) and the sweep/reminder primitives ship as on-demand ops triggers (ops:sweep-link-requests / ops:remind-link-requests); scheduled wiring is waived-with-sign-off to the canonical doc's cron-stream backlog ticket (deferred-items ledger D13). The arming runbook states the on-demand cadence that bounds the re-request lockout window.";
const WAIVER_8_26 =
  "The teacher_request_preference pgEnum (backend/db/schema/enums.ts:271), the teacher.request_preference column (backend/db/schema/teachers/teacher.ts:54), and the TS mirror exist and are probe-verified; the runtime intake (queue / reject / offer_alternatives) is waived-with-sign-off to the matching/intake backlog (deferred-items ledger D2).";
const RETENTION_ANTI_DRIFT = "backend/db/test/logic/shared/retention-anti-drift.test.ts";
const DRILL_BACKUP_TIMER = "ai/plans/milestone_4/production_launch_checklist_execution/outcome/backup-timer-signoff.md";
const DRILL_RESTORE_REPORT =
  "ai/plans/milestone_4/production_launch_checklist_execution/outcome/restore-report-<drill-stamp>.json";

export const LAUNCH_CHECKLIST: readonly LaunchRow[] = [
  // ── §1 · Data Integrity & Governance (17 rows) ──
  suite("1.1.1", 1, "backend/db/test/logic/shared/data-integrity.probe.test.ts"),
  suite("1.1.2", 1, "test/workflows/admin/admin-user-lifecycle.journey.test.ts"),
  suite("1.1.3", 1, "test/workflows/admin/admin-user-lifecycle.journey.test.ts"),
  suite("1.1.4", 1, "test/workflows/admin/admin-delete-with-history.journey.test.ts"),
  suite("1.1.5", 1, "test/workflows/admin/admin-user-lifecycle.journey.test.ts"),
  suite("1.2.1", 1, "backend/db/test/logic/billing/financial-immutability.test.ts"),
  suite("1.2.2", 1, "backend/db/test/logic/billing/financial-immutability.test.ts"),
  suite("1.2.3", 1, "backend/services/billing/admin-financial-auditing.service.test.ts"),
  suite("1.2.4", 1, "backend/db/test/logic/billing/financial-immutability.test.ts"),
  suite("1.3.1", 1, "test/workflows/admin/audit-completeness.journey.test.ts"),
  suite("1.3.2", 1, "backend/db/test/logic/audit/audit-immutability.test.ts"),
  suite("1.3.3", 1, "test/workflows/admin/audit-completeness.journey.test.ts"),
  suite("1.3.4", 1, "test/workflows/admin/audit-trail.journey.test.ts"),
  suite("1.3.5", 1, "test/workflows/admin/audit-completeness.journey.test.ts"),
  probe("1.4.1", 1, `bun run test/scripts/run-test.ts ${RETENTION_ANTI_DRIFT}`, RETENTION_ANTI_DRIFT),
  suite("1.4.2", 1, "backend/db/test/repo/teachers/evaluation.repository.test.ts"),
  probe("1.4.3", 1, `bun run test/scripts/run-test.ts ${RETENTION_ANTI_DRIFT}`, RETENTION_ANTI_DRIFT),
  // ── §2 · Financial & Escrow Safeguards (25 rows) ──
  suite("2.1.1", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.1.2", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.1.3", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.1.4", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.1.5", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.2.1", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.2.2", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.2.3", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.2.4", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.2.5", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.2.6", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  gql("2.3.1", 2, "frontend/graphql/test/billing/escrow-denial-codes.test.ts", "escrow-denial-codes"),
  suite("2.3.2", 2, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("2.3.3", 2, "backend/db/test/logic/billing/launch-financial-probe.test.ts"),
  suite("2.3.4", 2, "backend/db/test/logic/billing/launch-financial-probe.test.ts"),
  suite("2.3.5", 2, "backend/db/test/logic/billing/launch-financial-probe.test.ts"),
  suite("2.4.1", 2, "backend/services/classes/session-arbitration.service.test.ts"),
  suite("2.4.2", 2, "backend/services/classes/session-arbitration.service.test.ts"),
  suite("2.4.3", 2, "backend/services/classes/session-arbitration.service.test.ts"),
  suite("2.4.4", 2, "backend/services/classes/session-arbitration.service.test.ts"),
  suite("2.5.1", 2, "backend/services/billing/wallet.service.test.ts"),
  suite("2.5.2", 2, "backend/services/billing/admin-financial-auditing.service.test.ts"),
  suite("2.5.3", 2, "backend/services/billing/admin-financial-auditing.service.test.ts"),
  gql("2.5.4", 2, "frontend/graphql/test/billing/escrow-denial-codes.test.ts", "escrow-denial-codes"),
  suite("2.5.5", 2, "backend/db/test/logic/billing/launch-financial-probe.test.ts"),
  // ── §3 · Real-Time Reliability (17 rows) ──
  gql("3.1.1", 3, "backend/graphql/test/user-activity.integration.test.ts", "user-activity"),
  suite("3.1.2", 3, "test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts"),
  suite("3.1.3", 3, "test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts"),
  suite("3.1.4", 3, "test/workflows/teachers/teacher-availability.journey.test.ts"),
  suite("3.2.1", 3, "test/workflows/notifications/reconnect-catchup.journey.test.ts"),
  suite("3.2.2", 3, "test/workflows/notifications/reconnect-catchup.journey.test.ts"),
  suite("3.2.3", 3, "test/workflows/notifications/reconnect-catchup.journey.test.ts"),
  suite("3.2.4", 3, "test/workflows/notifications/reconnect-catchup.journey.test.ts"),
  suite("3.3.1", 3, "test/workflows/teachers/on-demand-matching.journey.test.ts"),
  suite("3.3.2", 3, "test/workflows/sessions/in-session-lock-release.journey.test.ts"),
  waived(
    suite("3.3.3", 3, "test/workflows/sessions/in-session-lock-release.journey.test.ts"),
    WAIVER_3_3_3,
    "Dev 3 (matching-flow backlog)"
  ),
  suite("3.3.4", 3, "test/workflows/sessions/in-session-lock-release.journey.test.ts"),
  suite("3.4.1", 3, "test/workflows/notifications/reconnect-catchup.journey.test.ts"),
  suite("3.4.2", 3, "backend/services/classes/session-report-notification.test.ts"),
  suite("3.4.3", 3, "test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts"),
  suite("3.4.4", 3, "test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts"),
  suite("3.4.5", 3, "backend/enum/notifications/notification-type-census.test.ts"),
  // ── §4 · Security (16 rows) ──
  suite("4.1.1", 4, "backend/lib/auth/jwt.test.ts"),
  gql("4.1.2", 4, "frontend/graphql/test/gateway/allowlist-coverage.test.ts", "allowlist-coverage"),
  suite("4.1.3", 4, "backend/lib/auth/jwt.test.ts"),
  suite("4.1.4", 4, "backend/lib/auth/jwt.test.ts"),
  suite("4.1.5", 4, "backend/db/test/logic/auth/auth.service.test.ts"),
  suite("4.1.6", 4, "test/workflows/admin/account-governance.journey.test.ts"),
  waived(
    suite("4.2.1", 4, "test/workflows/auth/registration-phone.journey.test.ts"),
    WAIVER_4_2_1,
    "Dev 2 (security-hardening backlog)"
  ),
  suite("4.2.2", 4, "backend/db/test/repo/classes/report.repository.test.ts"),
  suite("4.2.3", 4, "backend/lib/errors/test/security-abuse.contract.test.ts"),
  suite("4.2.4", 4, "backend/lib/auth/cookies.test.ts"),
  waived(
    gql("4.2.5", 4, "frontend/graphql/test/gateway/login-rate-limit.test.ts", "login-rate-limit"),
    WAIVER_4_2_5,
    "Dev 2 (security-hardening backlog)"
  ),
  suite("4.3.1", 4, "backend/db/test/logic/auth/auth.service.test.ts"),
  suite("4.3.2", 4, "backend/lib/errors/test/security-abuse.contract.test.ts"),
  gql("4.3.3", 4, "frontend/graphql/test/auth/auth.test.ts", "auth"),
  waived(suite("4.3.4", 4, "test/config/db-ssl.test.ts"), WAIVER_4_3_4, "Dev 2 (security-hardening backlog)"),
  probe("4.3.5", 4, "bun run scripts/launch/secrets-scan.ts .env.example backend/lib/env.ts", "secrets-scan"),
  // ── §5 · State Machine Invariants (34 rows) ──
  waived(suite("5.1.1", 5, "backend/services/classes/session-lifecycle.enforcement.test.ts"), WAIVER_5_1_1, "Dev 3"),
  waived(suite("5.1.2", 5, "backend/services/classes/session-lifecycle.enforcement.test.ts"), WAIVER_5_1_1, "Dev 3"),
  suite("5.1.3", 5, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("5.1.4", 5, "backend/db/test/repo/classes/session.repository.test.ts"),
  suite("5.1.5", 5, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("5.1.6", 5, "test/workflows/sessions/in-session-lock-release.journey.test.ts"),
  suite("5.1.7", 5, "backend/services/classes/session-report.service.test.ts"),
  suite("5.1.8", 5, "backend/services/classes/session-report.service.test.ts"),
  suite("5.2.1", 5, "test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts"),
  suite("5.2.2", 5, "backend/services/teachers/evaluation-booking.service.test.ts"),
  suite("5.2.3", 5, "test/workflows/teachers/cooldown-state-machine.test.ts"),
  suite("5.2.4", 5, "test/workflows/teachers/cooldown-state-machine.test.ts"),
  gql("5.2.5", 5, "backend/graphql/test/admin-applicant-override.wire.test.ts", "admin-applicant-override"),
  suite("5.2.6", 5, "test/workflows/teachers/applicant-student-conversion.journey.test.ts"),
  suite("5.3.1", 5, "backend/db/test/repo/students/student.repository.test.ts"),
  suite("5.3.2", 5, "backend/services/billing/subscription-activation.service.test.ts"),
  suite("5.3.3", 5, "test/workflows/billing/subscription-expiry.journey.test.ts"),
  gql("5.3.4", 5, "backend/graphql/test/session-booking-balance.test.ts", "session-booking-balance"),
  suite("5.3.5", 5, "backend/services/classes/session-lifecycle.service.test.ts"),
  gql("5.3.6", 5, "frontend/graphql/test/subscription-admin/subscription-admin.test.ts", "subscription-admin"),
  probe("5.4.1", 5, "bun run scripts/launch/probe-constraints.ts", "probe-constraints"),
  probe("5.4.2", 5, "bun run scripts/launch/probe-constraints.ts", "probe-constraints"),
  probe("5.4.3", 5, "bun run scripts/launch/probe-constraints.ts", "probe-constraints"),
  suite("5.4.4", 5, "backend/services/classes/session-lifecycle.service.test.ts"),
  suite("5.4.5", 5, "backend/services/billing/admin-financial-auditing.service.test.ts"),
  suite("5.4.6", 5, "backend/db/test/logic/billing/financial-immutability.test.ts"),
  suite("5.4.7", 5, "backend/services/teachers/teacher-re-evaluation.service.test.ts"),
  probe("5.4.8", 5, "bun run scripts/launch/probe-constraints.ts", "probe-constraints"),
  suite("5.5.1", 5, "test/workflows/parents/parent-monitoring.journey.test.ts"),
  suite("5.5.2", 5, "test/workflows/parents/parent-full-journey.journey.test.ts"),
  suite("5.5.3", 5, "test/workflows/parents/parent-monitoring.journey.test.ts"),
  suite("5.5.4", 5, "backend/services/parents/parent-link-request.chaos.test.ts"),
  suite("5.5.5", 5, "test/workflows/parents/parent-monitoring.journey.test.ts"),
  waived(suite("5.5.6", 5, "backend/services/parents/parent-link-request.service.test.ts"), WAIVER_5_5_6, "Dev 3"),
  // ── §6 · Performance & Load (7 rows) ──
  probe("6.1", 6, "bun run scripts/load/load-test.ts --url http://127.0.0.1:3100", "load-test"),
  probe("6.2", 6, "bun run scripts/load/matching-latency.ts", "matching-latency"),
  probe("6.3", 6, "bun run scripts/load/ws-soak.ts --url ws://127.0.0.1:3101", "ws-soak"),
  probe("6.4", 6, "bun run scripts/load/probe-explain-analyze.ts", "probe-explain-analyze"),
  gql("6.5", 6, "backend/graphql/test/query-count-regression.test.ts", "query-count-regression"),
  probe("6.6", 6, "bun run scripts/load/probe-indexes.ts", "probe-indexes"),
  gql("6.7", 6, "backend/graphql/test/notification-query.test.ts", "notification-query"),
  // ── §7 · Disaster Recovery (7 rows) ──
  drill("7.1", 7, "bun run ops:db-backup", DRILL_BACKUP_TIMER),
  suite("7.2", 7, "scripts/ops/backup-restore.integration.test.ts"),
  suite("7.3", 7, "scripts/ops/restore-verify.test.ts"),
  drSignoff("7.4", "Verify docs/ops/disaster-recovery.md:38 records RTO 4 hours (ratified)"),
  drSignoff("7.5", "Verify docs/ops/disaster-recovery.md:37 records RPO 1 hour (ratified)"),
  drSignoff(
    "7.6",
    "Verify docs/ops/disaster-recovery.md is the accessible DR plan (runbook + playbooks + quarterly cold-drill procedure)"
  ),
  drill("7.7", 7, "bun run ops:db-restore-verify --target <scratch-dsn> --yes-i-understand", DRILL_RESTORE_REPORT),
  // ── §8 · Decision Verification (33 rows) ──
  probe("8.1", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  probe("8.2", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  suite("8.3", 8, "backend/db/test/logic/students/handshake-code-generation-locks.test.ts"),
  probe("8.4", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  suite("8.5", 8, "backend/db/test/logic/audit/audit-immutability.test.ts"),
  probe("8.6", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  suite("8.7", 8, "backend/db/schema/users/users-governance.static-assertions.test.ts"),
  probe("8.8", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  probe("8.9", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  probe("8.10", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  suite("8.11", 8, "shared/constants/evaluation-rubric.constants.test.ts"),
  suite("8.12", 8, "backend/services/classes/session-lifecycle.service.test.ts"),
  signoff(
    "8.13",
    8,
    "bun run test/scripts/run-test.ts shared/constants/session-fees.constants.test.ts",
    "docs/planning/PRODUCTION_READINESS.md"
  ),
  suite("8.14", 8, "test/workflows/sessions/session-dual-confirmation.journey.test.ts"),
  suite("8.15", 8, "test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts"),
  suite("8.16", 8, "backend/db/test/repo/teachers/applicant.repository.test.ts"),
  suite("8.17", 8, "test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts"),
  probe("8.18", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  probe("8.19", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  probe("8.20", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
  suite("8.21", 8, "backend/enum/shared/surah-juz-ref.enum.test.ts"),
  suite("8.22", 8, "backend/db/test/repo/students/student.repository.test.ts"),
  suite("8.23", 8, "backend/db/test/repo/students/student.parent-monitoring.repository.test.ts"),
  suite("8.24", 8, "backend/services/parents/parent-link-request.service.test.ts"),
  suite("8.25", 8, "backend/services/teachers/teacher-inactivity.service.test.ts"),
  waived(
    probe("8.26", 8, "bun run scripts/launch/probe-decisions.ts", "probe-decisions"),
    WAIVER_8_26,
    "Dev 3 (matching/intake backlog)"
  ),
  suite("8.27", 8, "backend/services/billing/subscription-admin.service.test.ts"),
  gql("8.28", 8, "backend/graphql/test/session-arbitration.wire.test.ts", "session-arbitration"),
  suite("8.29", 8, "backend/db/test/logic/admin/admin-user.repository.test.ts"),
  suite("8.30", 8, "backend/db/test/repo/teachers/evaluation.repository.test.ts"),
  suite("8.31", 8, "backend/db/schema/classes/report-homework-schema.static-assertions.test.ts"),
  suite("8.32", 8, "backend/db/test/repo/classes/recitation.repository.test.ts"),
  suite("8.33", 8, "backend/db/test/logic/shared/schema-registry-census.test.ts"),
  // ── §9 · Launch Sign-Off (17 rows) ──
  sig("9.1", "Engineering Manager"),
  sig("9.2", "Dev 1 (Student & Parent)"),
  sig("9.3", "Dev 2 (Teacher Lifecycle)"),
  sig("9.4", "Dev 3 (Matching & Admin)"),
  sig("9.5", "Product Owner"),
  gate("9.6"),
  gate("9.7"),
  gate("9.8"),
  gate("9.9"),
  gate("9.10"),
  gate("9.11"),
  gate("9.12"),
  gate("9.13"),
  row("9.14", 9, "AUTOMATED-TEST", "bun tsgo", "logs/<run-stamp>/tsgo.log"),
  row("9.15", 9, "AUTOMATED-TEST", "bun run validate:mermaid", "logs/<run-stamp>/validate-mermaid.log"),
  gate("9.16"),
  signoff(
    "9.17",
    9,
    "Verify all five Section 9 signature rows and the Launch Approved line are filled in docs/planning/PRODUCTION_READINESS.md — evidence-existence check only",
    "docs/planning/PRODUCTION_READINESS.md"
  ),
];

/**
 * The rows owned by a stage — every registry row belongs to exactly one
 * stage (the stage whose section number it mirrors), so the union of
 * `rowsForStage` over `STAGES` is the whole registry with no orphans and
 * no overlaps.
 */
export function rowsForStage(stage: LaunchStage): readonly LaunchRow[] {
  const section = SECTION_FOR_STAGE[stage];
  return LAUNCH_CHECKLIST.filter(entry => entry.section === section);
}
