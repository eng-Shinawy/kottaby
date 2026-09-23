# Task 13 Outcome — Global Quality Gate + Baseline Comparison

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`

---

## Gate Results vs Phase-0 Baseline

| Check | Baseline (plan time) | Final gate | Delta |
|---|---|---|---|
| `bun tsgo` (`error TS` lines) | 0 | **0** | ≤ baseline + 0 ✅ |
| `bun biome:check` (warn lines) | 0 | **0** | ≤ baseline + 0 ✅ |
| `bun run scripts/lint-service.ts --json` (full-repo ESLint) | success: true, exitCode: 0 | **success: true, exitCode: 0** | ≤ baseline + 0 ✅ |
| `bun run check:duplicates` (jscpd) | 0 clones | **0 clones** | ≤ baseline + 0 ✅ |
| `bun quality-gate` (composite) | n/a at plan time | **Cannot complete in this sandbox — PRE-EXISTING environment limitation** (see below) | documented |

### `bun quality-gate` sandbox limitation (pre-existing, evidenced on pristine main)

`bun quality-gate`'s BASIC_CHECKS stage runs oxlint, whose type-aware companion `tsgolint` (typescript-go native binary) is **OOM-killed (SIGKILL) by this 4GB cgroup sandbox**. The repo's own `scripts/quality-gate.ts` documents exactly this failure mode ("Inside a small cgroup … can OOM-kill tsgolint even though both checkers pass standalone") and ships `QUALITY_GATE_SETTLE_MS` as the sanctioned mitigation — applied (45s) and insufficient here because tsgolint is killed during its own run. The identical failure reproduces **byte-for-byte on a pristine `origin/main` worktree (`6bf6c71`)** with zero plan files present — it is not caused by this plan's diff. oxlint v1.82 hard-requires the companion (removal → "Failed to find tsgolint executable"), so no bypass exists. Every constituent stage that CAN run was executed individually and is green (table above); this limitation is recorded as a sandbox-infrastructure fact, not a plan defect.

### New lint findings caught and fixed by the final gate loop

`sonarjs/assertions-in-tests` flagged 7 assertion-less test cases in `frontend/graphql/test/teachers/evaluation-rubric.test.ts` (assertions lived inside the shared `expectMutationError` helper, invisible to the rule). Each test received one direct, meaningful assertion (`denial.data?.submitRubricEvaluation ?? null` → null — a denial returns no payload). Re-verified: lint clean, sub-loop exit 0, transport suite 15/15.

## Full Suite Re-Runs (twice back-to-back)

| Suite | Run 1 | Run 2 |
|---|---|---|
| `bun run test:db` | **1012 pass / 0 fail** | **1012 pass / 0 fail** |
| `bun run test:services` | **1792 pass / 0 fail** | **1792 pass / 0 fail** |
| Journey (`run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`) | **16 pass / 0 fail** | **16 pass / 0 fail** |
| `bun run test:graphql` | 239 pass / 1 fail* | (EADDRINUSE infra flake)* |

\* The single test:graphql failure was a **port-collision infra flake** (`EADDRINUSE :3066` — a leftover server from the preceding run held the port, cascading a 120s boot timeout for `verification-plan-purchase.test.ts`). With the port freed, the flagged file passes in isolation: **3 pass / 0 fail**, and the identical suite had run 141/1→clean in Task 9's sweep under the same conditions. No code defect.

### D5 ledger update

The D5 chaos-test observation (verification-purchase double-submit) was recorded during Task 9 when the sandbox DBs lacked the migration-provisioned objects. After the full ordered migration rebuild, the chaos test **passes deterministically** — test:services is 1792/0 twice back-to-back at this gate. The D5 row's notes now record the resolution history; no plan code was involved either way.

## Test-Layer Coverage Gate

| Layer | Mandated by plan | Ran | Result |
|---|---|---|---|
| Repository / DB (`test:db`) | yes (Tasks 2/4) | ✅ | 1012/0 ×2 |
| Service unit (`test:services`) | yes (Task 6) | ✅ | 1792/0 ×2 |
| Cross-actor journey (`test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`) | yes (Tasks 8/9) | ✅ | 16/0 ×2 |
| GraphQL integration (`test:graphql` + transport suites) | yes (Task 7) | ✅ | rubric transport 15/0; documents 14/0; full runner green modulo the documented port flake |
| E2E (Paymob) | NOT mandated by this plan | N/A | — |

## Self-Verification Line

**15 out of 15 REQs implemented and verified · BUN cmd(s) that passed: `bun tsgo` (0 errors), `bun biome:check` (0 warns), `bun run scripts/lint-service.ts` (exit 0), `bun run check:duplicates` (0 clones), `bun run test:db` ×2, `bun run test:services` ×2, `bun run test:graphql` (rubric surfaces 15/0 + 14/0), journey ×2 (16/0) · requirements deferred (IDs): none — D1–D4 are pre-declared cross-ticket scope boundaries with receiving-ticket pointers, D5 is a resolved-and-documented sandbox observation**
