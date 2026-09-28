# Task 3 Outcome — i18n Errors Leaf `applicantCooldownExtensionInvalid`

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-002, REQ-007) · **Design:** `plan.md` (D7, §9 i18n leaf) · **Ledger:** `deferred-items.md` · **Task def:** `tasks.md` Phase 1
> **Scope guard:** Task 3 touched ONLY the errors-namespace locale surface (+ its parity suite pin); zero backend/frontend code touched. Git handles the commit (orchestrator-owned).

---

## 1. Files modified (exact diff surface)

| File | Delta | Change |
|---|---|---|
| `shared/locale/types/errors/labels.ts` | +8 | Added `readonly applicantCooldownExtensionInvalid: string` to the EXISTING flat `applicant*` errors group (immediately after `applicantAlreadyCertified`, before `adminUsers`) with a domain-only JSDoc. No new group created — the applicant keys are flat top-level leaves on `ErrorsLabels`, matching the blocker ticket's shipped keys (`applicantNotFound`/`applicantCooldownActive`/`applicantStatusCorrupt`/`applicantAlreadyCertified`). |
| `shared/locale/en/errors/index.ts` | +1 | `applicantCooldownExtensionInvalid: "Cooldown extension days must be between 1 and 3650."` — pinned copy, static leaf. |
| `shared/locale/ar/errors/index.ts` | +1 | `applicantCooldownExtensionInvalid: "يجب أن تكون أيام تمديد فترة التهدئة بين 1 و3650 يوماً."` — formal MSA, no identifiers. |
| `shared/locale/errors-namespace.parity.test.ts` | +14/−5 | Parity citation for the new key (see §3). |

Diff verified scoped: `git diff --numstat -- shared/locale/` → exactly the four rows above; `git status` noise from the parallel Task 1 agent (backend enum/types files, `outcome/1-outcome.md`, its own `tasks.md` checkbox flips) is NOT part of this task's diff.

## 2. Copy decisions (REQ-007.3 bounds leaf)

- **en** — verbatim per plan §9/`tasks.md`: `"Cooldown extension days must be between 1 and 3650."`
- **ar** — formal MSA; mirrors the existing ar errors conventions verified in-file before writing:
  - **Western digits** (`1`, `3650`) — every existing ar entry uses Western digits (`بين 1 و3650 يوماً` in `adminUsers.suspensionPeriodInvalid`, `255 حرفاً`, `2000 حرف`, `بين 0 و100`); the `١/٣٦٥٠` Eastern-digit variant in the task's illustrative example was NOT used.
  - **`و` glued to the number** (`بين 1 و3650`) — same as `suspensionPeriodInvalid`.
  - **Tanwin style** (`يوماً`, alef-before-fathatan) — mirrors the file's dominant style (`رقماً صحيحاً`, `يوماً`).
  - **Terminology: `فترة التهدئة`** — the only in-repo Arabic rendering of "cooldown" (`shared/locale/ar/adminTeachers/index.ts:21` → `cooldown: "فترة التهدئة"`), also the term in the task's example. NOTED DEVIATION: `plan.md:514`'s illustrative copy says `فترة التبريد`; D7's binding decision text itself pins only "ONE new leaf (the bounds-rejection copy)" + "formal MSA, no ids", while `tasks.md` (verbatim-authoritative) explicitly instructs to check existing ar entries first and mirror their conventions — so the in-repo terminology (`التهدئة`) wins for product-copy consistency. Recorded here for the review waves.
  - **Unit word `يوماً` included** — mirrors `suspensionPeriodInvalid` ("... بين 1 و3650 يوماً"), the closest sibling bounds-reject in the same group.

## 3. Parity-suite citation (`errors-namespace.parity.test.ts`) — why a 4th file

The suite's applicant-lifecycle pin is an EXHAUSTIVE inventory: it loops every `applicant*` key on the ar map and asserts membership in `APPLICANT_LIFECYCLE_KEYS` (lines 252-261 pre-change). Adding the new leaf without updating that pin would have made the mandated-green parity test FAIL (`3.TE` gate). The evidence pack's binding formatting convention — "en + ar i18n parity is cited into the parity suite for every new key" — and the blocker-ticket precedent (its seven rubric keys are pinned in this same suite) both mandate the citation. Minimal change only:

1. `APPLICANT_LIFECYCLE_KEYS` += `"applicantCooldownExtensionInvalid"` (drives the `test.each` non-empty check for ar+en).
2. Section docblock parenthetical now includes "admin-cooldown-extension denials".
3. New `applicantCooldownExtensionInvalid carries ZERO ICU placeholders in BOTH locales` test, mirroring the adjacent `applicantAlreadyCertified` static-leaf pin — this is the executable lock for the 3.TE "no interpolations" property.

No other parity suite regressed: `applicant-namespace.parity.test.ts` (which imports both errors maps) re-ran green — its `APPLICANT_ERROR_KEYS` pin is non-exhaustive and its whole-map placeholder-name-parity sweep admits the new zero-placeholder leaf.

## 4. Gate results

| Gate | Command | Result |
|---|---|---|
| 3.QL | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` ×4 (labels.ts, en, ar, parity test — the script accepts ONE file per invocation, so the task's 3-file one-liner was expanded to per-file runs) | exit 0 on every file (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates all green; the parity test is outside jscpd scan scope — skipped-by-design). Applicable rule files printed and read: root `AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md`, `.agents/instructions/tests.instructions.md`. |
| 3.TE | `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` | **50 pass / 0 fail** (382 expect calls) — includes the new key's ar+en pins, the zero-ICU-placeholder pin, and the exhaustive-inventory drift guard. |
| 3.TE (cross-check) | `bun run test/scripts/run-test.ts shared/locale/applicant-namespace.parity.test.ts` | **35 pass / 0 fail** — sibling suite unaffected. |
| 3.SEC | manual + `icuPlaceholdersOf` pin | Copy contains no identifiers (no applicant/actor ids, no machine codes) in either locale; static copy only. |
| 3.SR | `rg` over the Task-3 diff | ZERO matches for `Translation\.`, two-arg `getTranslations(`, `console.`, and plan-artifact references (`REQ-\d`, `Task \d`, `tasks.md`, `specs.md`, `plan.md`, `jscpd`) — diff is clean. |
| 3.IV | read printed rule files | `shared/locale/AGENTS.md` rules honored: `@/` alias discipline (no new imports needed), leaf modules stay pure object/string literals, no logic added, types stay in `types/errors/labels.ts` with no frontend/codegen references. |

## 5. Semantic-review checklist (execution protocol §3)

- Tenancy: N/A — locale leaf, no DB surface.
- Races: N/A — static strings.
- Enums-as-values: N/A — no enum touched.
- No cross-layer imports: ✓ zero imports added anywhere in the diff.
- No dead code: ✓ the key ships intentionally ahead of its Task 4 consumer (`extendApplicantCooldown` → `t.applicantCooldownExtensionInvalid`); compile-time parity keeps it type-checked until then.
- Two-source split: N/A — no write path in this task.

## 6. Hand-off notes

- **Consumer contract for Task 4:** single-arg `getServerTranslations(locale).errorsTranslations.applicantCooldownExtensionInvalid` → `ValidationError("APPLICANT_COOLDOWN_EXTENSION_INVALID", …)`; the leaf is flat (top-level on `ErrorsLabels`), never under a grouped sub-block.
- **Reviewer note:** the ar terminology choice (`فترة التهدئة` over `plan.md`'s illustrative `فترة التبريد`) is intentional (in-repo consistency, §2); flag only if the review waves want it re-litigated.
- Tasks 1/2 run in parallel; their checkboxes/files are theirs. No `git commit` performed (orchestrator-owned).
