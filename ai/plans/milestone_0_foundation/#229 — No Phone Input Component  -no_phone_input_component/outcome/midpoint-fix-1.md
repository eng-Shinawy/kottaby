# Mid-point fix (MP-fix-1)

Task ID: MP-fix-1 · branch `feat/no-phone-input-component` · scope: comments + typing only (no production code, no checkbox changes).

## Finding 1 [MEDIUM] — plan-artifact references in journey-test comments
File: `test/workflows/auth/registration-phone.journey.test.ts` — every citation replaced with domain-behavior wording:
- Docblock header: "the plan's §Cross-Actor Journey Capture … (REQ-6.4, REQ-9.1)" → "Journey J1 — the cross-actor contract: every registration/admin write path that persists `users.phone` meets ONE shared server-side validation rule at the service trust boundary".
- Step-8 list entry: "(REQ-4.4 — no onboarding-side code)" → "(no onboarding-side validation code — the delegation inherits the create-path rule)".
- `VALID_PHONE`: "the plan's step-4 example" → "12 chars, the shape every write path accepts".
- `INVALID_PHONE`: "the plan's step-2/6/8 payload" → "rejected by the shared E.164 rule on every write path".
- Step-2 inline: "REQ-9.3: the localized message never echoes the hostile input." → "The localized message never echoes the hostile input."
- Step-8 inline: "Inheritance proof (REQ-4.4)" → "Inheritance proof: … the onboarding flow owns NO phone-validation code of its own."

## Finding 2 [LOW] — stale TEST-FIRST narration
Same file; the suite is GREEN, so narration now states the final contract:
- "TEST-FIRST EXPECTATION … RED by design" docblock → "FINAL CONTRACT (all nine steps asserted green against the wired validation)": ONE E.164 rule (`PHONE_REQUIRED` / `PHONE_INVALID` / `PHONE_TOO_LONG` past the 16-char schema ceiling), single-`phone`-field `ValidationError`, ZERO rows persisted + ZERO dispatches on denial, verbatim persistence on success, track-before-teardown discipline.
- Step headers 2/3/6/8: "(TEST-FIRST RED)" removed.
- `TOO_LONG_PHONE` docblock: legacy `MAX_PHONE_LENGTH = 20` + "pre-wiring contract ACCEPTS it (step 3/7 RED)" removed → "ONLY the schema bound (never the column width) rejects it".
- `attemptServiceCall` docblock + `expectDomainRejection` message: RED narration → regression-safety narration. New thrown message: "expected a domain rejection, but the service call resolved successfully — the shared phone-validation or authorization contract did not fire". Checked first: NO test asserts that literal string (it is only thrown; the sole other repo occurrence is historical prose in `outcome/4-outcome.md`, left untouched).
- `afterAll` sweep comments: "RED-mode leak rows / resolved pre-wiring" → "leak rows from a contract regression (an invalid-phone call that unexpectedly resolved)".
- Track-before-assert comments at steps 2 and 8 rewritten to the same regression-safety framing.

## Finding 3 [LOW] — untyped `adminCreateInput()` in wire test
File: `frontend/graphql/test/auth/auth.test.ts` — added `type AdminCreateUserInput` to the existing generated-types import (from `frontend/graphql/generated/gql/graphql`) and annotated the helper: `function adminCreateInput(phone: string): AdminCreateUserInput` — mirroring `registrationInput(phone): RegisterUserInput`. Type-only; zero runtime change; no codegen; no generated files edited.

## Verification
1. Journey: `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts` → **9 pass / 0 fail** (98 expect() calls, 1.80s).
2. Wire: `bun run test:graphql frontend/graphql/test/auth/auth.test.ts` → **24 passed / 0 failed** (95 assertions, 12.00s). Honesty note: the first attempt failed with a 120s test timeout — root cause environmental: a leaked `next dev -p 3066` server (PIDs 24073/24086, started 20:21 in this worktree by an earlier task run) held port 3066 (`EADDRINUSE` in `logs/next-dev-server-3066.log`), so the harness server never booted. Killed ONLY those leaked worktree PIDs; the unrelated `/home/z/my-project` dev server (PID 2447) was left running. Immediate clean re-run: 24/24.
3. Sub-loop `--lifecycle duplicates`, one invocation per touched file:
   - journey test → **exit 0** (tsgo ✓, oxlint ✓, biome:check ✓, lint:type-aware ✓; check:duplicates skipped — outside jscpd scope).
   - auth.test.ts → **exit 0** (same stages ✓). (A first multi-file invocation passing all three frontend paths exited 1: the script targets only the LAST arg and oxlint finds no lintable file for a `.d.ts` — command misuse on my side, not a file defect; per-file runs are the correct form.)
   - Honesty note (per `outcome/3-outcome.md`): the sub-loop tsgo stage can false-pass on project-wide OOM, so the scoped-tsgo fallback ran as real evidence: temp tsconfig OUTSIDE the repo (`extends` root tsconfig; `incremental:false`; `typeRoots` pinned to the repo's `node_modules`) including exactly the two touched files + `frontend/providers/theme/types.ts` + `frontend/types/apollo-client.d.ts` → `tsgo -p <cfg> --noEmit` **exit 0**. Negative control (scratch file assigning `{ fullName: "x" }` to `AdminCreateUserInput`) → `error TS2740 … missing … country, email, gender, password` **exit 1**, proving the `@/` alias resolves and the gate engages. Scratch configs removed afterwards.
4. Grep proof: `rg -n "REQ-[0-9]|plan's|tasks\.md|specs\.md|#229" test/workflows/auth/registration-phone.journey.test.ts` → **0 matches** (rg exit 1).

## Files touched
- `test/workflows/auth/registration-phone.journey.test.ts` (comments/strings only)
- `frontend/graphql/test/auth/auth.test.ts` (type-only import + return annotation)
