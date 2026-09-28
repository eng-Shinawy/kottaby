# Task 4 Outcome — `ApplicantLifecycleService.extendApplicantCooldown` + `deriveCooldownState`

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-003..REQ-010) · **Design:** `plan.md` §3.3/§5.3/§5.4/§6 · **Task def:** `tasks.md` Phase 2
> **Scope guard:** Task 4 touched ONLY the service file, its test file, the orchestrator-authorized mapper fix, and the plan's own tracking files (`tasks.md` checkboxes, this outcome). No `git commit` (orchestrator-owned).

---

## 1. Files created / modified

| File | Change | Evidence |
|---|---|---|
| `backend/services/teachers/applicant-lifecycle.service.ts` | EXTEND/APPEND (8 hunks, +245/−14): module docblock gains the 4th responsibility + the write-scope/logging discipline updates; value imports `AuditActionType`, `ApplicantCooldownState`, `withTransaction`, `AuditService`, type `ApplicantCooldownExtensionAudit`/`AuditLogWriteContract`; `MS_PER_DAY` + `EPOCH_PAST` + bounds constants as siblings of `COOLDOWN_FORMATTERS`; `deriveCooldownState` (pure, strict `>`); `denyAlreadyCertified` shared-rejection helper; `composeCooldownExtensionAudit` (details = field NAME + from/to ISOs + additionalDays, never PII); `getMyApplicantProfile` extended additively (one `cooldownState` derivation against the SAME captured `now` + one return-object key; the existing `cooldownActive`/`canPurchaseVerification` derivations untouched); `extendApplicantCooldown` appended as the last namespace method |
| `backend/services/teachers/applicant-lifecycle.service.test.ts` | EXTEND (+597-line append + docblock/import/helper updates): `deriveCooldownState` 4-arm suite; profile `cooldownState` suite (3 states + strict-`>` live boundary + certified-none consistency + closed-shape 8-key pin); `extendApplicantCooldown` suite (19 tests: happy/audit, expired-base, null-base, bounds ×3, boundary 1+3650, certified, missing, actor attribution, two-source split, audit-FK rollback, guarded-write-miss chaos, post-write re-read chaos, bilingual bounds, 2 concurrency probes). Pre-existing suites untouched except the closed-shape key list (7 → 8 keys) — their 37 tests still green |
| `backend/services/admin/user-management.mappers.ts` | AUTHORIZED FIX (3 hunks, +8/−1): `buildApplicantSnapshot` constructs `cooldownState: deriveCooldownState(row.applicantCooldownUntil, new Date())`. Implementation chosen: **option A — export `deriveCooldownState` from the service module and import it**. `backend/services/AGENTS.md` prescribes exactly this ("consumers … import that owning service by reference — never the repository or table directly"; single-writer discipline), so no local mirror was needed. Docblock notes the shared strict boundary so the admin snapshot cannot drift from the applicant-facing profile. This resolves Task-1 carry-over TS2741 error #2 |

### Deviations from plan §5.3 pseudocode (documented)

1. **Optional 5th parameter `outerTx?: DBTransaction` (FINAL position).** The plan's 4-arg signature is kept as the first four positional args; the composition seam follows the `backend/services/AGENTS.md` single-writer rule ("Composition seams accept the caller's `outerTx` as the FINAL parameter so composed writes join the caller's transaction") and the file's own family convention (all three lifecycle functions already accept optional `tx` last, per `docs/teachers/applicant-lifecycle.md` §2.2). The resolver contract (Task 6) is unaffected — 4 positional args.
2. **Post-write profile re-read INSIDE the transaction.** Plan pseudocode re-shapes after commit via `getMyApplicantProfile(applicantId, locale)`; the shipped method re-reads through the SAME `tx` (fail-closed on the impossible null) so the returned profile always reflects the write it just made and stays atomic with it. The post-commit `logger.logDomainError("APPLICANT_COOLDOWN_EXTENDED", …)` still fires only after the transaction boundary resolves.
3. **`deriveCooldownState` is exported**, not module-private — the direct consequence of authorized option A for the mapper (plan §5.4 called it module-private when the mapper consumer was unknown; Task 1's carry-over review assigned the mapper to this task with the export option).

## 2. Method contract (what shipped)

- **Bounds BEFORE any DB contact:** `!Number.isInteger(additionalDays) || < 1 || > 3650` → `ValidationError("APPLICANT_COOLDOWN_EXTENSION_INVALID", getServerTranslations(locale).errorsTranslations.applicantCooldownExtensionInvalid)`. The bounds test proves precedence with an ABSENT applicant + out-of-bounds length → the bounds code wins.
- **One transaction:** `withTransaction(outerTx, …)` wraps `findByUserId` (status guard + old expiry) → certified check → `extendCooldownOnce(applicantId, newExpiry, tx)` → `AuditService.createAuditLog(…, tx)` → in-tx profile re-read. An audit-insert failure (actor-FK violation probe) rolls the cooldown write back WITH it — no orphan write, no audit row.
- **Server-computed instant only:** `newExpiry = new Date(Math.max((cooldownUntil ?? EPOCH_PAST).getTime(), now.getTime()) + additionalDays * MS_PER_DAY)` — the raw `additionalDays` never reaches the write; an expired/NULL base re-arms from the captured `now`; an active base is honored verbatim (only LENGTHENS, never shortens).
- **Typed misses:** missing row → `NotFoundError("APPLICANT", …)` → `APPLICANT_NOT_FOUND` (logged once, byte-equal localized); `passed` → `ValidationError("APPLICANT_ALREADY_CERTIFIED")` via the shared `denyAlreadyCertified` helper; a guarded-write miss after a passing read (concurrent certification) collapses onto the same typed certified rejection — never an illegal extension.
- **Audit:** exactly ONE row, `AuditActionType.Adjust`, `entityType: "applicant"`, `entityId: applicantId`, `actorId` = the 3rd positional arg (the resolver's `ctx.user.id`; there is no input field), details JSON `{"field":"cooldown_until","from":<iso|null>,"to":<iso>,"additionalDays":N}`.
- **`deriveCooldownState`:** `null → None`; `cooldownUntil > now → Active` (strict `>`, the boundary shared with the purchase guard); else `Expired`. Consumed by `getMyApplicantProfile` against the same captured `now` that drives `cooldownActive` — the three fields cannot drift (pinned by the mutual-consistency tests).

## 3. Verification results

| Gate | Command | Result |
|---|---|---|
| 4.QL | `bun run scripts/health/sub-loop.ts backend/services/teachers/applicant-lifecycle.service.ts --lifecycle duplicates` | ✅ exit 0 (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates) |
| 4.QL | `… sub-loop.ts backend/services/teachers/applicant-lifecycle.service.test.ts --lifecycle duplicates` | ✅ exit 0 (check:duplicates skipped-by-design for `*.test.ts`, outside jscpd scope) |
| 4.QL | `… sub-loop.ts backend/services/admin/user-management.mappers.ts --lifecycle duplicates` | ✅ exit 0 |
| 4.TE | `bun run test/scripts/run-test.ts backend/services/teachers/applicant-lifecycle.service.test.ts` | ✅ **56 pass / 0 fail / 327 expects** |
| 4.TE (regression) | `… run-test.ts backend/db/test/logic/teachers/applicant-lifecycle.test.ts` | ✅ 10 pass / 0 fail |
| 4.TE (regression) | `… run-test.ts backend/db/test/repo/teachers/applicant.repository.test.ts` | ✅ 17 pass / 0 fail |
| Typecheck | `bun tsgo` | ✅ exit 0 — **ZERO errors total** (both Task-1 TS2741 carry-overs resolved) |

### Two-source-split grep proof (the 4.SEC/REQ-006.2 gate)

- `rg "users\.suspended|suspendedAt|suspendedPeriodDays" backend/services/teachers/applicant-lifecycle.service.ts` → **exactly 1 match: line 19**, inside the PRE-EXISTING module docblock (`… never `users.suspended` or any governance field`) — the documented absence, not a write. ZERO matches anywhere else.
- `git diff -U0 backend/services/teachers/applicant-lifecycle.service.ts | rg "^\+" | rg "users\.suspended|suspendedAt|suspendedPeriodDays"` → **ZERO matches in the added lines**.
- Import proof: `rg "from \"@/backend/db/schema" backend/services/teachers/applicant-lifecycle.service.ts` → **zero matches** — the `users` table is not imported into the module at all (no schema import of any kind; all data access flows through `ApplicantRepository`).
- Runtime lock: the test reads the account row via a DIRECT Drizzle query (`readUserRow`) after a successful extension — `suspended === false`, `suspendedAt === null`, `suspendedPeriodDays === null` while the applicant cooldown moved.

## 4. Test-case inventory (new, 27 tests across 3 suites)

- **`deriveCooldownState` (4):** null → None; future → Active; past → Expired; EXACTLY-now → Expired (strict `>`), fixed instants (deterministic).
- **`getMyApplicantProfile — derived cooldownState` (5):** none/None + purchasable; future/Active + not-purchasable; past/Expired + purchasable; EXACTLY-now live boundary → Expired; certified-none → None but not-purchasable (consistency per status). Plus the pre-existing profile suite's closed-shape pin now asserts EXACTLY the canonical eight keys.
- **`extendApplicantCooldown` (19):** happy (failed + active → lengthened verbatim from the stored instant; returned profile reflects it; ONE audit row with full details JSON; post-commit event logged once); expired-base re-arms from now (audit `from` = stale instant); null-base re-arms from now (audit `from` = null); bounds 0 / 3651 / negative → INVALID (0-case proves validation precedes the DB read via the absent-applicant trick); boundary 1 and 3650 accepted with verbatim instants; `passed` → ALREADY_CERTIFIED (one log, no write, no trail); missing → NOT_FOUND (byte-equal ar, one log, no trail); audit-insert FK failure rolls the write back; guarded-write-miss chaos → typed certified rejection, nothing persisted; post-write re-read miss chaos → fail-closed NOT_FOUND, nothing persisted; actor attribution (3rd positional arg, ≠ applicant, ≠ admin-B); two-source split (governance triple untouched, read directly); extend-vs-finalize `Promise.allSettled` (both guarded predicates compose: status flips AND cooldown lengthens, exactly ONE audit row); extend-vs-certification `Promise.allSettled` (typed conflict or terminal supersede — never an extended cooldown left behind); bilingual bounds denial (byte-equal per locale, distinct across).

All tests: `runInRollback` + `tx` propagated to every service/repo/entity-setup call + `expectRepoError` try/catch. Zero `.rejects`, zero `mock.module`, zero seed-data queries; the two chaos probes use `spyOn` with `mockRestore` in `finally`.

## 5. Pipeline checklist evidence

- **4.QL** ✅ — three per-file sub-loops exit 0 (§3).
- **4.TE** ✅ — T1: every `extendApplicantCooldown` branch (bounds, missing, certified guard-read arm, expired/NULL base arm, active base arm, guarded-write miss arm, post-write re-read arm) + both `deriveCooldownState` arms exercised, several via deterministic stubs; T2: all bounds/boundary cases + strict-`>` boundaries; T3: the two concurrency probes via `Promise.allSettled`; T4: actor-attribution probe + bilingual/identity probes.
- **4.SEC** ✅ — `actorId` is the 3rd positional parameter (resolver hands `ctx.user.id`; no input object exists to forge — pinned by the attribution test); bounds validation runs before any DB read; the write receives the server-computed `newExpiry: Date`, never the raw `additionalDays`; grep proof §3.
- **4.SR** ✅ — zero `evaluation-rubric.*` imports (only a docblock sentence explains why `MS_PER_DAY` is module-private); `AuditActionType`/`ApplicantStatus`/`ApplicantCooldownState` are VALUE imports; `getServerTranslations(locale)` single-arg + `.errorsTranslations.*` property access; the `users` table is NOT imported; `withTransaction` gives the write+audit one commit/rollback fate.
- **4.IV** ✅ — rule files read before/while verifying: root `AGENTS.md`, `backend/AGENTS.md`, `backend/services/AGENTS.md` (single-writer/composition-seam rule — the basis for the `outerTx` + mapper-import decisions), `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`.

## 6. Comment discipline

Zero references to REQ IDs, task numbers, phases, or plan artifacts in any code comment/JSDoc across all three files (grep-verified). Docblocks describe domain behavior only (captured-now discipline, strict-`>` boundary, monotonic extension semantics, audit content guarantees, two-source split).

## 7. Notes for downstream tasks

- **Task 5 (journey):** the service-level two-source-split runtime lock (`readUserRow` pattern) is reusable for journey step 2/5; the extension's monotonicity ("only lengthens") is what makes the journey's `≈ now+90d` assertion safe against clock skew.
- **Task 6 (mutation):** `ApplicantLifecycleService.extendApplicantCooldown(args.applicantId, args.additionalDays, ctx.user.id, ctx.locale)` — 4 positional args, no try/catch in the resolver; the optional 5th `outerTx` stays omitted (the mutation owns no outer transaction). Error codes surface as-is: 422 (`APPLICANT_COOLDOWN_EXTENSION_INVALID`, `APPLICANT_ALREADY_CERTIFIED`) and the `APPLICANT_NOT_FOUND` taxonomy mapping.
- **Review wave (2.5/9):** report-only observation — the admin snapshot (`buildApplicantSnapshot`) derives `cooldownState` from a real captured `now` while its PRE-EXISTING `cooldownActive: false` hardcode remains; that hardcode predates this plan (zero-delta for this slice), but the internal asymmetry is worth a look if the admin snapshot ever grows a live boolean.
- Orchestrator: no `git commit` performed; `tasks.md` Task 4 checkboxes (4. + 4.QL/4.TE/4.SEC/4.SR/4.IV) flipped.
