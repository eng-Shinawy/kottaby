# Mid-Point Review — Round 1 (R1)

**Plan:** `ai/plans/milestone_2/in_session_locking_hide_from_directory/`
**Scope:** 13 code/test files vs origin/main (backend phases 1–3 + task 4.1 complete; docs phase 5 not started)
**Method:** three parallel review subagents — review-backend (architecture/TOCTOU/dead code/lock order), review-types (canonical naming/imports/enums/dead exports), review-security (BOLA/IDOR/privilege-escalation/injection/oracle-safety/tampering). Each re-read the plan files + all outcome files + applicable AGENTS/instruction docs.

---

## Aggregated findings (3 — deduplicated, pre-existing filtered)

| # | Sev | Source | Finding | Disposition |
|---|-----|--------|---------|-------------|
| 1 | MEDIUM | review-backend | `teacher.repository.ts` `findById` non-tx raw-SQL SELECT list omitted `was_online_before_lock` (type/runtime divergence; latent trap for tx-less callers; no current misbehavior) | FIXED (R1): column added to SELECT list with `AS "wasOnlineBeforeLock"` mapping |
| 2 | LOW | review-backend | `session-lifecycle.transitions.ts` module docblock enumerated release-composing exits without admin-governance cancel | FIXED (R1): enumeration extended to `(completion, participant cancel, arbitration, admin-governance cancel)` |
| 3 | LOW | review-types | Debug-log payloads re-stated the outcome discriminator as untyped literals instead of `result.outcome` | FIXED (R1): both payloads interpolate `result.outcome` (narrowing guarantees identical strings; toEqual pins unchanged) |

**review-security: FINDINGS: 0** — nine-point attacker-posture probe clean (BOLA/IDOR server-derived ids only; privilege escalation impossible; Available-direction race guard composed by construction; oracle safety clean; SQL injection clean — all 12 `${` sites machine-pinned; hostile ids proven; log hygiene clean; schema exposure zero; marker tampering impossible — three-writer map holds).

**Pre-existing (filtered, not counted):** governance-helpers docblock re-export claim; booking-vs-exit theoretical lock-order window (unchanged by branch); canonical docs §6.2 pending 5.1; disputed-session INV-A2 window (ledger D5); deploy-cutover transient (plan §11); 4.1's two pre-existing RED suites (proven on origin/main).

## Fix round (R1)

Fix subagent applied all 3 fixes in the two-file cluster. Verification: sub-loop `duplicates` exit 0 on both files · `bun tsgo` 0 errors · repo suite 80/0 · INV-S6 81/0 · governance 52/0 · journey 17/0 · `git diff --name-only` = exactly the two target files. Evidence: `outcome/midpoint-fix-R1-outcome.md`.

## Verdict

**Mid-point gate PASSED at R1** — zero findings remaining after one fix round. Backend phases proceed to docs (5.1/5.2).
