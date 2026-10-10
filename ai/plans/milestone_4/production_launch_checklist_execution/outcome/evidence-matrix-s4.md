# Evidence Matrix — §4. Security (Task 5.3 · REQ-013 AC-3)

**Checklist section:** `docs/planning/PRODUCTION_READINESS.md` §4 — Security · **16 rows** (15 AUTOMATED-TEST · 1 SCRIPT-PROBE)

**Reconciliation source (definitive gate report):** `docs/planning/launch-report-20261009T191940Z.json` — 173 rows, 165 PASS / 8 WAIVED / 0 FAIL; verdict FAIL solely because the 8 waiver signatories are blank (task 4.5 signs). The earlier `launch-report-20261009T165246Z.json` (64 rows) is historical evidence, not a reconciliation source.

**Section tally:** 13 PASS + 3 WAIVED = 16 rows — every report row with `section: 4` appears exactly once below, no extras, none missing (16/173 of the full census).

**Disposition notation:** `✅ PASS` = report `result: PASS`, `exitStatus: 0` (all 173 rows carry exitStatus 0). `☐ WHY` = report `result: WAIVED` — the row carries its waiver verbatim from the report's `waivers[]` array (WHY text + named owner), keyed to the `deferred-items.md` ledger pointer; full waiver text in the Waiver detail section below. All evidence paths are repo-relative.

## Matrix (rowId → modality → command → evidenceRef → disposition)

| rowId | modality | command | evidenceRef | disposition |
|---|---|---|---|---|
| `4.1.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/lib/auth/jwt.test.ts` | `logs/2026-10-09T22-12-09/backend/lib/auth/jwt.test.ts.log` | ✅ PASS |
| `4.1.2` | AUTOMATED-TEST | `bun run test:graphql frontend/graphql/test/gateway/allowlist-coverage.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-allowlist-coverage.log` | ✅ PASS |
| `4.1.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/lib/auth/jwt.test.ts` | `logs/2026-10-09T22-12-09/backend/lib/auth/jwt.test.ts.log` | ✅ PASS |
| `4.1.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/lib/auth/jwt.test.ts` | `logs/2026-10-09T22-12-09/backend/lib/auth/jwt.test.ts.log` | ✅ PASS |
| `4.1.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/auth/auth.service.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/auth/auth.service.test.ts.log` | ✅ PASS |
| `4.1.6` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/admin/account-governance.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/admin/account-governance.journey.test.ts.log` | ✅ PASS |
| `4.2.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/auth/registration-phone.journey.test.ts.log` | ☐ WHY + owner — waived (ledger D5); full text in Waiver detail below; signatory blank at report time |
| `4.2.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/classes/report.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/classes/report.repository.test.ts.log` | ✅ PASS |
| `4.2.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/lib/errors/test/security-abuse.contract.test.ts` | `logs/2026-10-09T22-12-09/backend/lib/errors/test/security-abuse.contract.test.ts.log` | ✅ PASS |
| `4.2.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/lib/auth/cookies.test.ts` | `logs/2026-10-09T22-12-09/backend/lib/auth/cookies.test.ts.log` | ✅ PASS |
| `4.2.5` | AUTOMATED-TEST | `bun run test:graphql frontend/graphql/test/gateway/login-rate-limit.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-login-rate-limit.log` | ☐ WHY + owner — waived (ledger D14); full text in Waiver detail below; signatory blank at report time |
| `4.3.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/auth/auth.service.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/auth/auth.service.test.ts.log` | ✅ PASS |
| `4.3.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/lib/errors/test/security-abuse.contract.test.ts` | `logs/2026-10-09T22-12-09/backend/lib/errors/test/security-abuse.contract.test.ts.log` | ✅ PASS |
| `4.3.3` | AUTOMATED-TEST | `bun run test:graphql frontend/graphql/test/auth/auth.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-auth.log` | ✅ PASS |
| `4.3.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/config/db-ssl.test.ts` | `logs/2026-10-09T22-12-09/test/config/db-ssl.test.ts.log` | ☐ WHY + owner — waived (ledger D15); full text in Waiver detail below; signatory blank at report time |
| `4.3.5` | SCRIPT-PROBE | `bun run scripts/launch/secrets-scan.ts .env.example backend/lib/env.ts` | `logs/2026-10-09T22-12-09/secrets-scan.log` | ✅ PASS |

## Waiver detail (verbatim from the report's `waivers[]`)

**4.2.1:**

- **WHY:** Input validation is proven on the auth/admin surfaces (registration battery, phone/password policies, GraphQL non-null type system); exhaustive per-field fuzzing and GraphQL depth/complexity limiting are post-launch hardening (deferred-items ledger D5) — only the 2MB body cap ships today (backend/lib/gateway/transport-guard.ts:49).
- **Owner:** Dev 2 (security-hardening backlog)
- **Ledger pointer:** `deferred-items.md` D5 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

**4.2.5:**

- **WHY:** The shipped loginAccountLimiter is in-memory, per-instance, and fail-open (backend/lib/ratelimit.ts:125-127); the distributed limiter via the installed-but-unused @upstash/redis, per-account lockout, and a login-specific per-IP limiter are post-launch hardening (deferred-items ledger D14) — transport-level IP throttling is the existing gateway-wide limiter (app/api/graphql/rate-limit.ts:56), and the GraphQL context exposes no client IP.
- **Owner:** Dev 2 (security-hardening backlog)
- **Ledger pointer:** `deferred-items.md` D14 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

**4.3.4:**

- **WHY:** Encrypted TLS is enabled for sslmode=require / Neon DSNs (backend/db/client.ts:42-46) with the rejectUnauthorized: false posture recorded as a signed launch note; CA-verified TLS is post-launch hardening (deferred-items ledger D15). The production DATABASE_URL MUST carry sslmode=require (launch condition).
- **Owner:** Dev 2 (security-hardening backlog)
- **Ledger pointer:** `deferred-items.md` D15 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

## Reproducibility

- Row registry: `scripts/launch/launch-checklist.ts` · gate harness: `scripts/launch/launch-gate.ts` · report writer: `scripts/launch/launch-report.ts` (per-row tuples + stages + waivers + verdict)
- Re-run: `LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… ADMIN_PASSWORD='Seed_Pass1!' bun run scripts/launch/launch-gate.ts` (drill servers on `127.0.0.1:3100` / `:3101`); log evidence under `logs/<run-stamp>/`
- This matrix: 16/16 §4 rows reconciled 1:1 with the definitive report; count-verified (total across §1–§9 matrices: 173/173).

