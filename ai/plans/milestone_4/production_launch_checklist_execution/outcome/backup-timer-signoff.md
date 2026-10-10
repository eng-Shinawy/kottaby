# Backup-Timer Ops Sign-Off — Row 7.1 (MANUAL-DRILL evidence, Task 4.1)

Date: 2026-10-09 · Filed by: Task 4.1 (DR cold-operator drill + evidence filing) · Requirements: REQ-009 (AC-2/AC-6) · Ledger refs: D7 (operator-side arming/sign-off), D9 (DR-plan deferral re-confirmations)

This is the row-7.1 evidence artifact the launch gate existence-marks (`scripts/launch/launch-checklist.ts` `DRILL_BACKUP_TIMER`; drill-filing contract, `outcome/1.2-outcome.md` §D). It records the operator-side backup-schedule evidence demanded by the DR runbook (`docs/ops/disaster-recovery.md:42`, scheduling stanzas `:87-125`) and re-confirms the DR plan's own deferrals (D9). **The production timer arming itself is an operator-side, environment-level sign-off (D7): the repo ships the tooling and this record; a human operator signs below.**

## 1. Cadence invariant + measured runtime (RPO side)

Runbook arithmetic (`docs/ops/disaster-recovery.md:42`): worst-case data loss = `interval + runtime + jitter ≤ RPO 1h`.

- **Measured backup runtime (this drill, 2026-10-09):** manifest `backups/20261009T130732Z/manifest.json` — `startedAtUtc 2026-10-09T13:07:32.579Z` → `finishedAtUtc 2026-10-09T13:07:32.663Z` = **84 ms** (dev-scale dataset; dump = 158,669 bytes).
- **RPO budget check:** runbook 30-minute stanza + 84 ms runtime + `RandomizedDelaySec=120` jitter ≈ **32.08 minutes ≤ 60 minutes RPO — satisfied with ~28 minutes of margin**.
- **Daily-only cadence breaks the budget outright** (`:42`, `:94`): a daily schedule satisfies the checklist's daily minimum but NOT RPO 1h — the 30-minute stanza is the RPO-compliant cadence.
- **Re-derivation warning (runbook `:87`):** the 84 ms figure is dev-scale; production must re-derive the interval from the production manifest's `durationMs` after dataset growth.

## 2. Operator-side timer evidence observed (this host, 2026-10-09)

Recorded honestly — this is a **development workstation**, not the production host:

- `systemctl list-timers --all` → **no kottaby/backup systemd timer present**.
- `crontab -l` → no `crontab` binary / no user crontab on this host.
- `/etc/systemd/system/kottaby-db-backup.timer`, `/etc/cron.d/` → **absent**.

**Conclusion:** no live production backup schedule is armed yet. This is the expected pre-launch state: scheduler arming is environment-side (D7) and belongs to the launch-arming runbook (`docs/ops/launch-arming-runbook.md`, task 4.3) plus the production operator's sign-off below. The repo-side requirement is fully shipped: `ops:db-backup` (`package.json`), the RPO-compliant 30-minute stanzas (cron + systemd unit/timer, `docs/ops/disaster-recovery.md:87-125`), the run-lock overlap guard, and the `_FAILED`-run preservation rule.

## 3. DR-plan deferral re-confirmations (D9 — re-confirmed, never re-opened)

Per `docs/ops/disaster-recovery.md:314-320` (the DR plan's own deferral registry) and ledger D9 (re-confirmed as §7 sign-off lines at this drill — not re-opened; a reopen requires a new plan):

| DR deferral | Status at this drill | Owner |
|---|---|---|
| **D-001** Neon PITR / managed-backup console configuration + screenshot evidence (outside the repo) | 📅 Forward — unchanged; the verified logical backup remains the only verified path; PITR stays a complementary layer | Operator / launch-checklist gate |
| **D-002** Scheduled CI restore drill (scheduled `restore-verify` against an anonymized staging dump; needs CI scratch-Postgres secrets) | 📅 Forward — unchanged; the quarterly cold drill (this task) is the pre-launch verified cadence | Post-launch DevOps CI hardening |
| **D-003** Off-site (second-region / object-storage) upload of backup artifacts | 📅 Forward — unchanged; the run-directory + manifest layout is uploader-ready | Post-launch infrastructure |

## 4. Sign-off lines (human — filled at §9 collection, task 4.5)

- **Production backup timer armed (30-minute cadence or re-derived equivalent satisfying `interval + runtime + jitter ≤ RPO 1h`), timer output attached to the ops runbook evidence:** Operator: ________ · Signatory: ________ · Date: ________
- **D-001 / D-002 / D-003 re-confirmations acknowledged (§3 above):** Signatory: ________ · Date: ________

## 5. Filing provenance

- Drill run: `backups/20261009T130732Z` (manifest SHA-256 `8848b679e03178600c89c71336fc323db1f4a3da8907a36a2ddadf7f54423e54`, journal hash `4f1224979a5c5ba6f120f699ef65aeff20a246ec809b2e2cc8f4b228a7ca1f`).
- Companion artifacts: `outcome/4.1-outcome.md` (timing table, friction log, VERDICT record), `outcome/restore-report-20261009T130736Z.json` (row 7.7's contract artifact).
- No credentials, DSNs, tokens, or secret values appear in this file (D7 redaction discipline).
