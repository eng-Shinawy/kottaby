# R6 — Independent Re-Verification Review Round 6

**Plan:** ai/plans/sprint_1/dev3-004-session-creation-lifecycle-scheduled-sta/
**Branch:** feat/dev3-004-session-creation-lifecycle-scheduled-sta @ a14c61c + uncommitted F-1/F-3 working-tree fixes (reviewed at working-tree state)
**Round scope:** verify all 6 R5 findings fixed; executable-identity spot-check of the comment sweep; fresh 4-lens sweep (types/backend/frontend/security) for new findings.
**Note:** this outcome file was persisted by the orchestrator on the reviewer's behalf — the reviewer completed all verification work, then the sandbox tool layer refused persistence calls (transport 403s). Content below is the reviewer's verbatim report.

---

## (a) Per-finding fix verification — 6/6 PASS

1. **Service header docblock (R5-TB #1) — PASS.** `session-lifecycle.service.ts:55-59` now has an honest "Cross-surface dependency policy": ONLY cross-surface dependency = wallet repository, composed into dual confirmation to credit teacher earnings on student confirm; nothing from notification/audit/report. Matches reality: `WalletRepository` import at :73, credit slice ~:769-775.
2. **backend/services/AGENTS.md bullet (R5-TB #2) — PASS.** Line 7 now reads "writes ZERO notification/audit/report rows, and its ONLY cross-surface write is the wallet repository's credit…". Plan refs dropped; bullet domain-worded. Remaining REQ/Task refs in *other* bullets are doc-file prose, PRE-EXISTING per R5-TB.
3. **service.test.ts import pin (R5-TB #3) — PASS (honest + fail-closed).** Test :1312-1370: (1) every `from "…"` specifier must be in an explicit 13-entry allowlist → direct wallet/notification/audit/report/billing service imports fail; (2) the only `@/backend/db/` specifier must be the barrel AND its named member list is pinned exactly (6 members incl. `WalletRepository` by name — cross-checked against the real import at service.ts:67-74) → deep-repo bypass or new barrel member fails; (3) only `@/backend/services/` specifier = `withTransaction`; plus duplicate-import guard. No tautology; all failure modes fail closed. Theoretical residual: `from "…"` scan can't see dynamic `import()`/`require` (zero exist today) → recorded as NEW hardening note below.
4. **Plan-artifact refs (R5-SEC/TB-FE) — PASS.** `rg "DEV3-[0-9]|REQ-[0-9]|R-20[0-9]|plan §|4\.BFBS|cron-r2|D9-bis"` = **0 hits in all 6 files** (also 0 for `R-1xx|R-2xx|DEV2-|DEV1-|task \d|Phase \d|tasks\.md|specs\.md|plan\.md|outcome §|gate A\d|.ai/plans`). Mutation header now lists exactly the 7 registered mutations (verified against 7 `mutationField(` registrations — pre-fix header under-counted at 6).
5. **F-1 repo pins — PASS (consistent).** Independently re-counted against `session.repository.ts`: interpolations **17** with per-expression census exactly matching the ALLOWED set (zero caller-input channels); `const executor = tx ?? db;` = **9**; `queryDb<` = **6**; `export async function` = **17**; `tx?: DBTransaction` = **20** (≥17 floor). Let-scan reasoned through: per-line comment-stripping state machine + statement-position check — docblock prose can't trip it, real `let` fails it.
6. **warning-surfacing 12-field inventory — PASS.** Committed SDL (`git show HEAD:frontend/graphql/generated/schema.graphql`) Mutation root = exactly the 12 fields pinned; working-tree schema byte-identical to HEAD; A2 gap-pin untouched.

## (b) Executable-identity spot-check — 5/5 IDENTICAL (all 5 sweep files, beyond the required 2)

Dual method: P1 diff-line classification (every changed line is comment syntax; counts 69/44/20/40/24 — matching F-3's records exactly) + P2 string/template-aware comment-stripped token comparison HEAD vs working. All of service.ts, mutation.ts, query.ts, StudentSessionsContainer.tsx, TeacherSessionsContainer.tsx (and the F-1 repo file) = **comment-only edits, executable code identical to HEAD**. (A first stripper pass showed spurious diffs; root-caused to a reviewer stripper bug — template-interpolation state desync from backticks inside docblocks — fixed, then all 5 verified by both methods.)

## (c) Fresh sweep findings

**New (3, 0 blocking):**

- `[NEW][LOW]` backend/services/classes/session-lifecycle.service.ts:854 — the codebase's only inline lint-suppression: `// oxlint-disable-next-line no-await-in-loop`, contradicting backend/services/AGENTS.md:170 ("NEVER use oxlint-disable comments") and docs/quality/linting-rules.md:3, whose no-await-in-loop recipe (:43) prescribes the recursive-helper pattern for exactly this shared-transaction sequential case. Introduced by DEV3-012 `4fd479b` (git log -S) post-close-out; the plan's task outcomes (1.4/2.1–2.7) all recorded "zero disable comments" gates — now false. Fix = executable micro-refactor, follow-up-task owner.
- `[NEW][LOW]` backend/services/classes/session-lifecycle.service.test.ts:1310 — new pin scans only `from "…"` clauses; a future dynamic `import("…")`/`require(…)` would bypass the allowlist. Zero dynamic imports exist today (honest now); add an absence-pin for `import\(|require\(` next revision.
- `[NEW][INFO]` backend/db/test/repo/classes/session.repository.test.ts:1222-1258 — let-scan checks statement position only; a `; let x` after another statement on the same line would be missed. Heuristic-pin caveat, record-only.

**PRE-EXISTING re-confirmed (unchanged from HEAD, R5 records carry over):** jscpd clone `cancelSessionOnce`≅`openDisputeOnce` (repo); jscpd clone in TeacherWallet suite; plan-prose refs in out-of-mandate files (SessionRow, dialog, documents/contract tests, service-test REQ-04x names); AGENTS.md doc-prose refs; pentest INFOs (unbounded page, teacher-existence oracle). `[ENV]` tsconfig.json M = provisioning artifact (`.next-dev/**` includes + reformat) — **must be excluded from the fix commit**; untracked phase0 outcome file likewise pre-existing.

**Clean sweeps:** 0 TODO/FIXME/HACK/XXX in all 82 span files; 0 `console.*` in span sources; 0 `as any`/`@ts-ignore`/eslint/biome-ignore (ts-expect-error only in sanctioned `.test-d.ts`); 0 MUI/theme/i18n violations in session UI (no `style={`, no hex/rgb, no `t('…')` literals, no `useLazyQuery`, no fake data); intent-overlay `Object.assign` comment now honest; **race check clean**: confirm predicate (status=Completed∧feeHeld∧stamps) vs sweeper (status=Scheduled∧deadline<now) are disjoint — no double refund/credit window; sweep refunds on one `withTransaction`, sequential, fail-closed.

**Suite re-run caveat:** all four layers were re-run green post-fix by F-3 (117/0 db, 54/0 service-direct, 66/0 graphql, 137/0/30skip ui); R6 independently re-verified the pin layers statically. R6's own dynamic re-run (test:db:sequential + service test) was blocked mid-round by the tool-session failure after static verification completed — no gate number is disputed.

## (d) Verdict

**R6 VERDICT: 3 new findings (0 blocking).** All 6 R5 fixes verified landed at working-tree state; all 5 comment-sweep files proven executable-identical to HEAD by two independent methods; working tree ready to commit as the fix set except the tsconfig.json provisioning artifact.

**Disposition:** F-4 micro-fix adds the dynamic-import absence-pin (finding 2); finding 1 (oxlint-disable refactor) recorded in the plan deferred ledger as a forward row with owner (executable refactor, out of verification-session scope); finding 3 is a record-only heuristic caveat. R7 sweeps fresh with these recorded.
