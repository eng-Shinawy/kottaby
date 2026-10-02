# Task 5 — Outcome: Shared backend phone-validation helper

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 5 — Shared backend phone-validation helper — `backend/services/shared/phone-validation.helpers.ts` (REQ-4.1, REQ-4.5, REQ-5.2, REQ-9.1, REQ-9.3, REQ-9.4, REQ-9.5)
> **Date:** 2026-09-30 · **Pipeline:** 5.QL → 5.TE → 5.SEC → 5.SR → 5.IV — all executed, all pass

## 1. Summary

Created the backend producer for the shared phone contract:
`validatePhoneField(value: string, locale: string): ApiFieldErrorType | null`. It parses the
value with `phoneSchema.safeParse` (`@/shared/lib/phone` — deep import, no barrel exists in
`shared/lib`) and, on failure, maps the FIRST issue's machine code to a fully localized
template via single-arg `getServerTranslations(locale)` (`@/shared/locale/server-graphql`,
sync static-bundle lookup):

| Code (from `phoneSchema`) | Localized template |
|---|---|
| `PHONE_REQUIRED` | `authTranslations.phoneRequired` |
| `PHONE_TOO_LONG` | `errorsTranslations.validation` |
| `PHONE_INVALID` | `authTranslations.phoneInvalid` |

Registered on the live barrel `backend/services/shared/index.ts` (one added line,
alphabetical) so Tasks 6/7 import `validatePhoneField` from `@/backend/services/shared` —
never a deep path.

**Design decision recorded for EC-9 (Task 1 carry-forward):** the helper parses the WIRE
value as-is (`safeParse(value)`); it does NOT call `normalizePhone` first. The schema itself
trims edge whitespace, so `" +201001234567 "` passes; interior formatting separators
(`+20 (100) 123-4567`) reject with `PHONE_TOO_LONG`. Producers that accept user-formatted
input must canonicalize with `normalizePhone` before persisting — that stays the caller's
concern, and the helper docblock says so.

**Contract invariants (REQ-9.3/9.4/9.5):** `field` is always the literal `"phone"`; the
`message` is a fixed localized template — the submitted value is never interpolated; the
error surface is exactly `ApiFieldErrorType` imported from `@/backend/types` (no local
redefinition, no service-layer `.types.ts`); the helper is pure/synchronous (no DB, no I/O —
cannot become a tenancy/enumeration oracle).

## 2. Files created / modified

| File | Action | Why |
|---|---|---|
| `backend/services/shared/phone-validation.helpers.ts` | **CREATED** | The Task 5 deliverable |
| `backend/services/shared/phone-validation.helpers.test.ts` | **CREATED** | Colocated 4-tier suite (15 tests) |
| `backend/services/shared/index.ts` | **EDITED** (+1 line) | Barrel registration: `export * from "./phone-validation.helpers";` |
| anything else | NOT touched | Hard rule — Tasks 6/7 wire the consumers |

## 3. Verification results

### 5.QL — Quality Loop: **exit 0 on BOTH files**

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`:

| File | tsgo | oxlint | biome | lint:type-aware | duplicates | Exit |
|---|---|---|---|---|---|---|
| `phone-validation.helpers.ts` | ✅ | ✅ | ✅ | ✅ | ✅ | **0** |
| `phone-validation.helpers.test.ts` | ✅ | ✅ | ✅ (2 arrow-paren autofixes, mirrored back) | ✅ | ✅ (skipped — outside jscpd scope, per script) | **0** |

⚠️ **tsgo-stage honesty note (Task 0 A2 / Task 3 recurrence):** `dmesg` shows the sub-loop's
project-wide tsgo was OOM-killed during this session (`Out of memory: Killed process … (tsgo)
… anon-rss:1290124kB`), and a NEGATIVE CONTROL through the sub-loop (scratch file with a
guaranteed TS2322) reported "tsgo passed" — i.e. the sub-loop tsgo line is a VACUOUS false
pass in this window, exactly as Task 3 documented. The REAL type evidence below (§3.1)
replaces it.

**3.1 Scoped tsgo gate (non-vacuous, Task 3's pattern):** temp config at
`/tmp/tsconfig.task5.json` (OUTSIDE the repo; extends the root tsconfig — `paths`, `strict`,
`types: ["bun"]` preserved via absolute `typeRoots`; `incremental: false`) with `include` =
the three touched files, run from the feat-content verification sandbox (§5):

- `tsgo -p /tmp/tsconfig.task5.json` → **exit 0, ZERO diagnostics** (full import closure:
  zod, locale bundles, `@/backend/types` barrel, `bun:test` types).
- **Negative control** (same config + a scratch probe assigning
  `ApiFieldErrorType | null` to `ApiFieldErrorType`) → `error TS2322` exit 1 — the gate
  genuinely type-checks the closure, so the clean run is real proof. Scratch config/probe
  files deleted afterwards; none remain in any repo tree.

### 5.TE — Test run (mandated runner, never raw `bun test`)

`bun run test/scripts/run-test.ts backend/services/shared/phone-validation.helpers.test.ts`
→ **15 pass / 0 fail, 261 expect() calls** (re-run green after the biome autofix mirror).

- **Tier 1 (branches × locales):** valid → `null`; `""` → `PHONE_REQUIRED`; 17-char →
  `PHONE_TOO_LONG`; `"12345"` → `PHONE_INVALID` — each asserted in `en` AND `ar` with
  `toEqual` against the EXACT template object; plus unknown-locale-tag fallback to the
  default locale (`ar`) templates.
- **Tier 2 (boundaries):** 16 chars parses vs 17 → too-long; 17-char INVALID-shape still
  reports `PHONE_TOO_LONG` (max precedes regex); `""`/3-space/17-space → `PHONE_REQUIRED`
  (min precedes max); edge-whitespace tolerated; interior formatting rejects;
  `+`+8 digits minimum valid vs 7 digits invalid; leading-zero country digit invalid.
- **Tier 3 (fuzz, deterministic corpus — no randomness):** 25 hostile payloads × en/ar never
  throw; `Promise.allSettled` concurrent parses all fulfill and agree with sequential parses
  (determinism, no shared mutable state).
- **Tier 4 (security):** for every hostile payload the message is EXACTLY one of the
  locale's three templates (`toContain` set-match — no echo possible), the raw value itself
  never appears in the message (`not.toContain`, corpus curated so no payload is a substring
  of any template), `field === "phone"` always, `code` ∈ the three machine codes.
- Pure unit tier — NO DB, no `runInRollback`, no server boot. Expected-template values are
  sourced from `getServerTranslations("en"/"ar")` at module scope — same pattern as
  `session-report.service.test.ts:125-127` (NOT hardcoded copy). Note: `tests.instructions.md`
  carries a legacy "getServerTranslations hangs in tests" rule; the current implementation is
  a synchronous static-bundle lookup (verified in `shared/locale/server-graphql.ts` →
  `server.ts`), five existing backend service tests call it at module scope, and this suite
  completed in <0.5 s — recorded here as a documented, precedented deviation, not a silent one.

### 5.SEC — Security & Tenancy Audit: PASS

- REQ-9.1: the helper IS the server gate — it never consults any client state; Tasks 6/7
  route every phone write path through it.
- REQ-9.3: message equals the localized template (asserted exactly); hostile-corpus probes
  assert no substring of the input leaks into the message; the helper contains no
  interpolation of `value` (grep: no template-literal use of the parameter).
- REQ-9.4: returns only `ApiFieldErrorType`/`null`; no exception text channel (the
  unreachable exhaustiveness guard throws a developer-facing invariant message containing
  only the machine code, never input — same pattern as `user-provisioning.helpers.ts:98-102`).
- REQ-9.5: pure/synchronous — no DB/IO/timing, no enumeration oracle surface.

### 5.SR — Semantic Review: PASS

- `ApiFieldErrorType` imported from `@/backend/types` (verified `backend/types/index.ts` →
  `./errors` → `./api-error.types`); **no** service-layer `.types.ts` created (only the
  helper, its test, and the one barrel line exist — `git status` verified).
- `getServerTranslations` single-arg + property access (`.authTranslations.*`,
  `.errorsTranslations.validation`) — mirrors `registration.service.ts` `validateInput`.
- No `console.*` (grep 0); no dead branches (all three switch arms exercised by tests;
  `default` is the house exhaustiveness guard); barrel uses relative `./` path per
  AGENTS.md barrel mechanics; no name collision on the barrel (tsgo clean — TS2308 would
  fire); `noFallthroughCasesInSwitch` satisfied.
- Import order `@/backend/types` → `@/shared/lib/phone` → `@/shared/locale/server-graphql`
  (biome-clean).

### 5.IV — Instruction Verification: PASS

Sub-loop printed and read: root `AGENTS.md`, `backend/AGENTS.md`,
`backend/services/AGENTS.md` (helper) + `.agents/instructions/tests.instructions.md`,
`.agents/instructions/backend.instructions.md` (test file). Validated: types-from-
`@/backend/types`, no service `.types.ts`, `getServerTranslations` discipline, no
`oxlint-disable`, no `console.*`, test-file house style (4 tiers, bun:test, mandated runner,
helpers extracted).

## 4. Environment notes (carry-forward criticals)

1. **feat/main divergence (A1, sharpened):** Tasks 0/1/3/8 artifacts are COMMITTED on
   `feat/no-phone-input-component` (`9a2b5bb2`) but HEAD keeps snapping back to `main`
   (reflog shows an external actor reverting within seconds — my `git switch` to feat was
   reverted at 18:59:08). The main-tree `outcome/` only contains `plan-review-R1.md`.
   Therefore ALL gates in §3 ran in a **verification sandbox**: `git archive
   feat/no-phone-input-component` extracted to `/tmp/task5-verify` (+ node_modules
   hardlinked, `.env`/`.env.test` copied) — repo git state untouched, zero commits made.
   The deliverable files live in the real working tree; they are untracked additions (+
   the one-line barrel edit) and carry over cleanly to the feature branch. NOTE: other
   agents' artifacts (Tasks 2/4/9) appeared concurrently in the same tree — same situation.
2. **tasks.md checkbox flip made on the LOCAL (main-side) tasks.md copy.** feat's tasks.md
   differs (Tasks 0/1/3/8 already flipped there), so the orchestrator must
   stash→switch→pop (or re-apply flips) when reconciling to
   `feat/no-phone-input-component`. The exact flipped line is §6 below.
3. **biome autofix mirror:** `biome:check` (`--write --unsafe`) inside the sub-loop removed
   two arrow-parameter paren pairs in the sandbox copy of the TEST file; the identical edit
   was applied to the real file and re-verified byte-identical + re-tested green + sub-loop
   re-run exit 0.

## 5. Carry-forward for Tasks 6 / 7 / 14 / 15

- **Exact import (Tasks 6/7):** `import { validatePhoneField } from "@/backend/services/shared";`
  → signature `validatePhoneField(value: string, locale: string): ApiFieldErrorType | null`.
  Returns `null` on valid; otherwise `{ field: "phone", code, message }` with `code` ∈
  `PHONE_REQUIRED | PHONE_TOO_LONG | PHONE_INVALID` and `message` fully localized at the
  producer. Push the non-null result into `entries` (`ApiFieldErrorType[]`) exactly like the
  existing per-field checks; `ValidationError(entries[0].message, entries)` ordering is the
  consumers' concern.
- **Task 6 (registration):** replace the `:213-215` phone block; keep `input.phone` REQUIRED
  shape — an empty/whitespace phone yields `PHONE_REQUIRED` from the helper (no special
  casing needed). 17-char → `PHONE_TOO_LONG` with `errorsTranslations.validation` (journey
  step 3's `message === errors.validation` assertion holds by construction — template is
  `"Invalid input."` / `"إدخال غير صحيح."`).
- **Task 7 (admin create/update):** create path may pass `""` → `PHONE_REQUIRED`; the UPDATE
  path must keep its `typeof patch.phone === "string"` + non-empty guard BEFORE calling the
  helper (empty string = clear → skip), or it will emit `PHONE_REQUIRED` on a clearing patch.
- **Task 14 (service-test consolidation):** reuse this suite's tier shapes; the helper's own
  15 tests already cover mapping × locales, boundaries, fuzz-no-throw, and the no-echo
  contract — service tests only need the THROUGH-the-service projections.
- **Task 15 (GraphQL wire):** server failures surface `PHONE_*` codes via
  `ValidationError.fields` — the helper's `code` values are exactly what the wire test
  asserts; `PHONE_INVALID` is produced by values like `"12345"` (no `+`, ≤16 chars).
- **Locale fallback:** unknown locale tags resolve to `ar` (`defaultLocale`) — consumers
  must always pass a real locale from context; the fallback is a last-resort behavior, not
  an API.

## 6. Progress tracking

- [x] 5. Shared backend phone-validation helper — `backend/services/shared/phone-validation.helpers.ts` — flipped in `tasks.md` (line: `- [ ] 5. Shared backend phone-validation helper — …` → `- [x] 5. …`), only that line.
