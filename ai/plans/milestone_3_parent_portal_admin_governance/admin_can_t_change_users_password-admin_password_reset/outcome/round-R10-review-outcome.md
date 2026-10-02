# Review Iteration R10 — Final Full Re-Sweep (All Lenses, Fresh Eyes)

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Feature tip:** `7760c5c9` · **Base:** `5a8369fe` · Delta: 131 files (+8,724 / −268; 43 A / 88 M) — `git diff 5a8369fe..7760c5c9`.
**Reviewer:** independent R10 (final gate — all perspectives at once, prioritized by risk). **Mode:** READ-ONLY for refs; the working tree was found externally reset to base `5a8369fe`, so the tip was materialized once via the sanctioned `git checkout 7760c5c9 -- .` (content restore only; no branch/ref changes). Prior outcomes read first: R1 (2), R2 (2), R3 (6), R4 (0), R5 (3), R6 (0), R7 (1), R8 (0), R9 (2) + post-fix-1..7 — every previously found item verified FIXED at the tip and excluded from re-reporting, along with the accepted items (http-200 literal, same-as-current-before-policy ordering, admin-vs-admin last-writer-wins, per-request gate snapshot, client snapshot races, fence-miss timing differential, once-per-session redirect latch, D1–D9 decisions incl. D2 token non-revocation).

## Scope & Method

Five-lens final sweep over the whole delta, re-probing the fix waves' own code adversarially:

1. **Security (fix-wave surfaces re-attacked):**
   - *Fenced conditional write* (`UserRepository.updatePassword:168-181`): Drizzle-composed `and(eq(users.id,…), eq(users.passwordHash,…))` — parameterized, no injection; `undefined` seed compiles to the id-only predicate (never an `= NULL` trap); zero rows → `null` → the SAME single `CURRENT_PASSWORD_INVALID` denial in the service; fence seed never logged/echoed (all three `logDomainError` sites carry `{code, entity, entityId, locale}` only); admin path deliberately omits the fence (§5.1). **No bypass, side channel, or retry oracle.**
   - *In-tx deleted guards* (`auth.service.ts:452-462` self path; `user-management.service.ts:489-497` admin path): both re-check the RETURNING row INSIDE the tx callback so the throw rolls the write back pre-commit (net zero writes); steady-state pre-compare folds (`:391-393`) close the delete-before-read phase; mid-flight window closed per post-fix-6. Constant `CURRENT_PASSWORD_INVALID` / `USER_NOT_FOUND` shapes — no governance oracle on either path.
   - *redirectTo consumer* (`error-surface.ts:104-145,215`): only producer is the pure map row hardwired to `CHANGE_PASSWORD_PAGE_PATH` (`error-link.map.ts:263` keys on `extensions.code` only) — **no open redirect**; once-per-session latch, exact+`endsWith` loop guard, browser-only, dispatch gate keeps the login-only + self-surfaced exclusions (the redirect exemption did NOT invert the dispatch gate); listener failure never blocks navigation.
   - *Session-sync seam* (`AuthProvider.tsx:86-88` + `useChangePasswordForm.ts:155-158`): merge is client-React-state only, stable `useCallback`, null-guarded, fired BEFORE `setSucceeded(true)` arms the effect-owned timer; both server enforcement boundaries (gate reads DB-refreshed `ctx.user` per request; SSR fence reads `getServerUserContext()`) are client-state-blind. **No spoofable trust path.**
   - *Affordance gating* (`UserHeroActions.tsx:82`, `DirectoryActionsMenu.tsx:76-86`): "Change password" collapses on `!isDeleted` on BOTH surfaces, matching the backend's deleted-target denial; dialog itself unchanged and conditionally mounted + keyed by target id on both containers.
   - *Gate* (`passwordChangeGate.ts` full re-read): closed 7-member case-sensitive allowlist; alias-proof extraction (`selection.name.value`); inline/named/transitive fragment flattening with cycle guard; per-operation deny; no Subscription type in the SDL; `didResolveOperation` pre-resolver; HTTP-200 head; registered exactly once inside `apollo-server.ts`'s plugins array (pinned by the gate suite's static scan). Escape-hatch matrix (introspection, batches, APQ, mixed exempt+gated) re-verified fail-closed.
2. **Backend semantics:** both service sequences re-traced step-by-step vs plan D4/D5/§4.3/§5.1 (actor guard → id guard → policy → hash-before-tx → tx{write → returned-row check → audit} / self: identity → deleted fold → compare → no-op guard → policy → hash → fenced write → in-tx deleted guard → fence-miss fold); `ValidationError` overload matrix re-checked (`(message, fields)` form stamps code `VALIDATION` — the policy denials' wire shape is coherent); single password-write home with exactly 2 production callsites; census row + `USER_LIFECYCLE_LEG` leg consistent; locale seam (`extractLocale` → always a supported string → `getServerTranslations` cannot receive undefined).
3. **Frontend:** `/change-password` page + form + hook re-read in full (conditional subtitle + notice share the mirror's exact predicate; effect-owned timer; `genericFailure` fallback; `password`→`newPassword` projection; disabled/succeeded guards); admin dialog + feedback hook contract identical to siblings; `withPageAuth` fence order auth → fence → role riding the same cached context row; `DashboardLayout` mirror loop-safe (target outside `(dashboard)`); `AuthFormHeader.subtitle` optional with both legacy consumers unaffected; MUI v9 sx discipline, logical-CSS icons, a11y attrs intact.
4. **Cross-layer:** type cascade single-source (schema column → `$inferSelect` → SAFE selects/row-types/mappers → both full-row raw SQL reads carry `must_change_password` (`user.repository.ts:52,85`) → services → Pothos → SDL → `graphql.ts` → documents → hooks/views); error-code spelling repo-grepped — `PASSWORD_CHANGE_REQUIRED`, `CURRENT_PASSWORD_INVALID`, `NEW_PASSWORD_SAME_AS_CURRENT` producer/consumer/i18n identical, policy codes ride `extensions.fields` (no map rows, by design). **Codegen sync re-executed at the tip: `bun run generate:gqlSchema` + `bun run codegen` both exit 0 and BOTH artifacts regenerate byte-identical (0-line diff vs committed `schema.graphql` and `gql/graphql.ts`) — no hand-edits, documents all resolve.**
5. **Tests (contract integrity at the tip):** journey/census/wire suites re-read (8-step journey with committed fixtures + zero-residue teardown + deep `passwordHash` walker; census bijection; 8-op integration matrix). Three allowed suites run **solo** (strays killed, `.next-test-dev/dev/lock` cleared):

| Suite | Result |
|---|---|
| `backend/graphql/test/password-change-gate.test.ts` | **38 pass / 0 fail** (122 ms) — incl. the real-listener glue + registration static scan |
| `backend/graphql/test/schema-surface.test.ts` | **104 pass / 0 fail** (488 ms) — incl. the admin credential-rotation SDL pins |
| `frontend/graphql/sharedDocuments/documents.contract.test.ts` | **33 pass / 0 fail** (151 ms) — incl. the `ChangeMyPassword` row |

The final increment `3f27a974..7760c5c9` was diffed in full: 6 source files, comment-only (artifact-token strips + the `withPageAuth` summary sentence), matching post-fix-7; no behavior change since the last green gates.

## Findings

| # | Severity | Location | Finding | Suggested fix |
|---|---|---|---|---|
| — | — | — | **Zero.** No new actionable finding in any lens. Candidate observations examined and rejected as non-actionable: (a) a blocked/suspended (vs deleted) caller can still clear the flag via the self path — pre-existing per-request enforcement semantics outside the delta (suspension is enforced at login/governance seams, not per-request), semantically defensible (a suspended user's credential stays live; a deleted one's cannot), and the `isDeleted`-only fold was the reviewed and accepted post-fix-3/6 remedy; (b) the `endsWith` loop-guard could over-suppress a hypothetical `/x/change-password` prefix path — contrived, loop-guard side, constant target; (c) the once-per-session latch never retries a blocked navigation — R4-documented accepted behavior, SSR fence still catches the next navigation; (d) fenced-miss timing differential and per-request gate snapshot — R4/R7-accepted informational items. None cross the actionable bar; none are new. | — |

## Confidence Evidence

- All 15 prior outcome files (R1–R9 + post-fix-1..7) read first; every previously reported finding (1 MEDIUM + 13 LOW + 3 test-pin LOWs + 2 comment LOWs) verified fixed in the tip content, in place.
- Adversarial re-probe of all five fix-wave surfaces (fence, in-tx guards, redirect consumer, session seam, affordance gating) found no bypass/oracle/leak/injection.
- Byte-identical codegen regeneration re-proves schema/document lockstep at the exact review tip (`7760c5c9`).
- The three allowed suites green solo at the tip with counts matching the last recorded gates (38 / 104 / 33).
- Delta boundary re-confirmed: 131 files, all plan-plausible; `app/api` delta confined to `apollo-server.ts`; no navItems/migration/session-store/mail files; no dependency changes.

## Verdict

**PASS — zero findings (0 HIGH / 0 MEDIUM / 0 LOW).** The feature is ship-ready at `7760c5c9` from every reviewed perspective: the enforcement boundary (gate → SSR fence → client mirrors) is closed and DB-authoritative; both credential writes share one fenced write home with constant-shape, zero-write denials and in-tx deleted guards; the client seams (redirect consumer, session sync, affordance gating) are safe, single-sourced, and pinned by tests; the generated artifacts are provably in sync; and the test contract at the tip is green. No fix wave required; nothing outstanding from this review.
