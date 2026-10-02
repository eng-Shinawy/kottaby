# Task 3 — i18n `phoneInvalid` Key Outcome (Phase 1)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 3 — add `phoneInvalid` to the three label groups + en/ar implementations (REQ-5.1, REQ-5.3, REQ-9.3)
> **Date:** 2026-09-30 · **Branch caveat:** HEAD found on `main` (anomaly A1 from Task 0 persists; checkout forbidden to subagents) — both branches point at the same commit, so the working tree is content-identical; the orchestrator must still commit this work on `feat/no-phone-input-component`.
> **Files modified (exactly 9, all in `shared/locale/`):** see §2. Nothing else in the repo was touched.

## 1. Summary

Added the static leaf key `phoneInvalid: string` to the three existing label groups and their en/ar implementations — **no new namespace, no `errors.validation` change, no `Translation.` enum, no two-arg `getTranslations`**:

| Namespace | Group | Types file | en | ar |
|---|---|---|---|---|
| `Auth` | `AuthLabels` (root) | `shared/locale/types/auth/index.ts:37` (after `phoneRequired` :36) | `:26` | `:26` |
| `AdminUsers` | `createDialog.phoneInvalid` | `shared/locale/types/adminUsers/index.ts:256` (after `phone` :254) | `:118` | `:114` |
| `AdminUsers` | `editDialog.phoneInvalid` | `shared/locale/types/adminUsers/index.ts:291` (after `phone` :289) | `:137` | `:133` |
| `StudentOnboarding` | `fields.phoneInvalid` | `shared/locale/types/studentOnboarding/index.ts:62` (after `phone` :61) | `:15` | `:15` |

Copy (D6 verbatim): en `"Please enter a valid phone number."` · ar `"يرجى إدخال رقم هاتف صحيح."` (formal MSA, no identifiers, no interpolation).

**Plan line-number drift (expected, verified):** plan cited `createDialog.phone` at `:226` and `editDialog.phone` at `:259`; actual anchors are `:254` and `:287` respectively (pre-edit numbering). `AuthLabels.phoneRequired` was indeed at `:36` and `fields.phone` at `:61` as cited. All keys placed adjacent to the existing `phone` anchors.

## 2. Files modified (9)

1. `shared/locale/types/auth/index.ts` — +1 line (`readonly phoneInvalid: string;`)
2. `shared/locale/en/auth/index.ts` — +1 line
3. `shared/locale/ar/auth/index.ts` — +1 line
4. `shared/locale/types/adminUsers/index.ts` — +4 lines (interface `createDialog` + `editDialog`, each: doc comment + `readonly phoneInvalid: string;`)
5. `shared/locale/en/adminUsers/index.ts` — +2 lines (createDialog + editDialog)
6. `shared/locale/ar/adminUsers/index.ts` — +2 lines (createDialog + editDialog)
7. `shared/locale/types/studentOnboarding/index.ts` — +1 line (`fields.phoneInvalid`)
8. `shared/locale/en/studentOnboarding/index.ts` — +1 line
9. `shared/locale/ar/studentOnboarding/index.ts` — +1 line

`git diff --stat` post-run: 9 files, **14 insertions(+), 0 deletions** in `shared/` (biome `--write --unsafe` inside sub-loop mutated nothing — re-verified).

Style conformance: `readonly` modifiers match each interface's local convention (types files); doc comments added in `adminUsers` types only because every sibling property there carries one; `auth`/`studentOnboarding` types use their neighbors' comment-free style. Locale leaf files are plain string literals only.

## 3. Verification results

### 3.QL — sub-loop per file (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`)

All nine files → **exit 0**:

| File | Exit |
|---|---|
| `shared/locale/types/auth/index.ts` | 0 |
| `shared/locale/en/auth/index.ts` | 0 |
| `shared/locale/ar/auth/index.ts` | 0 |
| `shared/locale/types/adminUsers/index.ts` | 0 |
| `shared/locale/en/adminUsers/index.ts` | 0 |
| `shared/locale/ar/adminUsers/index.ts` | 0 |
| `shared/locale/types/studentOnboarding/index.ts` | 0 |
| `shared/locale/en/studentOnboarding/index.ts` | 0 |
| `shared/locale/ar/studentOnboarding/index.ts` | 0 |

⚠️ **CRITICAL HONESTY NOTE — the sub-loop's tsgo stage is VACUOUS in this sandbox.** `sub-loop-checks.ts` runs tsgo project-wide (`bun tsgo`, `tsgo -b --noEmit` via the locked wrapper) and filters output for the target file. Direct measurement (three attempts: sub-loop spawn + two direct runs; consistent with Task 0 anomaly A2):

- `./node_modules/.bin/tsgo -b --noEmit` → **exit 137 (SIGKILL)**; dmesg: `Out of memory: Killed process … (tsgo) … anon-rss:2966292kB` (4.1 GiB sandbox, no swap; dev server must stay up).
- Because the killed process emits no `file(line,col)` diagnostics, `filterTsgoForFile` finds nothing and the stage reports "tsgo passed" in ~15 s — a **false pass**. The oxlint/biome/lint/duplicates stages inside sub-loop are real and file-scoped.

### Scoped tsgo fallback (the REAL compile-time `*Labels` gate evidence)

1. **Mandated fallback** `./node_modules/.bin/tsgo --noEmit --ignoreConfig <file>` per file:
   - The three `types/` files → **exit 0** (complete proof for them — zero imports, nothing unresolvable).
   - The six en/ar leaf files → exit 1 with **only** TS2307 (`Cannot find module '@/shared/locale/types/…'`) plus cascading TS7006 implicit-`any` params — i.e. `--ignoreConfig` drops the `paths` mapping, so the leaf-key annotation cannot resolve and **no key-parity signal is obtainable** from this variant alone. (This is why the stronger variant below was used.)
2. **Stronger scoped variant (substitute proof, recorded transparently):** temp tsconfig at `/home/z/tsconfig.task3.json` (OUTSIDE the repo; scratch file removed afterwards) `extends`-ing the root `tsconfig.json` (preserves `paths`, `strict`, `moduleResolution: "bundler"`; overrides `incremental: false`, `types: []`) with `include` = exactly the nine files:
   - `tsgo -p /home/z/tsconfig.task3.json --noEmit` → **exit 0, zero diagnostics**.
   - **Negative control (gate-engagement proof):** a scratch fixture typed `AuthLabels` with `phoneInvalid` deliberately omitted → `error TS2741: Property 'phoneInvalid' is missing in type … but required in type 'AuthLabels'` (exit 1). This proves the scoped config resolves the `@/` alias AND that the `*Labels` gate genuinely fires on a missing key — so the clean exit-0 run is **non-vacuous evidence** that all six leaf consts implement the new key.
3. Both scratch files were deleted after verification; the repo tree contains none of them.

### 3.TE — Test Engineering

- No runtime locale-parity test was added (per plan). Compile-time gate = scoped tsgo run above (exit 0 + negative control proving engagement).
- **Supplementary evidence — pre-existing runtime parity suites still pass with the new keys** (run via the mandated runner, never raw `bun test`; these files were NOT modified):
  - `bun run test/scripts/run-test.ts shared/locale/adminUsers-namespace.parity.test.ts` → exit 0, **71 pass / 0 fail**.
  - `bun run test/scripts/run-test.ts shared/locale/studentOnboarding-namespace.parity.test.ts` → exit 0, **52 pass / 0 fail**.
- Note: the plan's claim "there is NO existing `adminUsers`/`studentOnboarding` parity test" is **factually wrong for those two namespaces** — both parity suites exist and walk grouped sub-block leaves depth-first (the types-file headers say so explicitly). Only `auth` lacks a parity suite (pre-existing issue P4 / deferred D-8). Adding the key to BOTH en and ar kept both suites green; no test was invented for `auth` (D-8 stands).
- **Static-leaf assertion:** every new key is `readonly phoneInvalid: string` in the types files and a plain string literal in en/ar — none is a `(...)=>string` function; no ICU placeholders; no interpolation.

### 3.SEC — Security & Tenancy Audit

- Copy is a fixed localized sentence in both locales; **no PII placeholders, no identifiers, no raw-input interpolation** (REQ-9.3 alignment — nothing that could echo a submitted value). The adminUsers types-file header explicitly documents that admin-authored phone data renders verbatim and is never translated; `phoneInvalid` is chrome copy, consistent with that scope.
- Reviewable in both locales; Arabic copy is formal MSA matching the register of sibling keys (`emailInvalid`, `phoneRequired`).

### 3.SR — Semantic Review (checklist)

- ✅ No `Translation.` enum introduced anywhere (grep-verified across the nine files).
- ✅ No two-arg `getTranslations` introduced (no call sites touched; `server.ts`/`server-graphql.ts` untouched).
- ✅ Each `*Labels` change is **additive only** — no key removed/retyped/renamed; `Pick<AdminUsersLabels, …>` consumers (24 view-layer sites) are unaffected; `frontend/lib/mutationFieldErrors.test.ts:249`'s `satisfies readonly (keyof AuthLabels)[]` is unaffected (union growth only).
- ✅ Both locale objects implement the new key in all three namespaces (compile gate + parity suites + diff).
- ✅ No dead key *in the plan's end state*: consumed by Task 5 (`authTranslations.phoneInvalid`), Task 10 (`t.phoneInvalid`), Tasks 11/12 (`labels.createDialog.phoneInvalid` / `labels.editDialog.phoneInvalid`), Task 13 (`t.fields.phoneInvalid`). No in-repo consumer exists yet — that is the plan's sequencing, not dead code.
- ✅ Only the six leaf consts implement these interfaces repo-wide (grep-verified: no mocks/stories construct fresh literals of these types), so the additive change breaks nothing else.
- ✅ No cross-layer imports; leaf modules remain pure string-literal files (`shared/locale/AGENTS.md` "no logic" rule).

### 3.IV — Instruction Verification

Read and validated against: root `AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md` (sub-loop also printed root AGENTS.md; it reports no `.agents/instructions/*` file matches `shared/**`).

- `shared/locale/AGENTS.md`: leaf modules export single consts typed against `*Labels`; no logic; `@/shared/locale/...` alias discipline — all nine files conform (no imports changed; the leaf files' existing `@/` type imports untouched).
- `shared/AGENTS.md`: no `@/frontend|@/backend|@/app` imports (none added); canonical `*Labels` live in `shared/locale/types/**` (respected); compile-time translation system rules respected (static `string` leaf, no ICU string needed).
- Root `AGENTS.md`: no `console.*`; no barrels created; no new deps; deep-import conventions untouched.

## 4. Cross-file dependencies / carry-forward knowledge

**Exact key paths for later tasks (consume via property access only):**

| Consumer task | Key path | Source object |
|---|---|---|
| Task 5 (backend helper) | `getServerTranslations(locale).authTranslations.phoneInvalid` (single-arg) | `AuthLabels` via `en/ar/messages.ts` bundles |
| Task 10 (register) | `t.phoneInvalid` where `t = useAppTranslation(Auth)` (handle, not string) | `authEn`/`authAr` |
| Task 11 (admin create) | `labels.createDialog.phoneInvalid` | `adminUsersEn`/`adminUsersAr` |
| Task 12 (admin edit) | `labels.editDialog.phoneInvalid` | `adminUsersEn`/`adminUsersAr` |
| Task 13 (onboarding) | `t.fields.phoneInvalid` where `t = useAppTranslation(StudentOnboarding)` | `studentOnboardingEn`/`studentOnboardingAr` |

- `PHONE_INVALID` machine code (Task 1's `shared/lib/phone.ts` zod message) maps to these keys; `PHONE_TOO_LONG` stays on `errors.validation` (untouched — verified `shared/locale/types/errors/labels.ts` was not modified).
- `shared/lib/phone.ts` appeared as an untracked file from the concurrent Task 1 subagent during this task's run; no interaction with the nine locale files (Task 1's QL remains its own task's responsibility).
- Runtime parity suites for `adminUsers`/`studentOnboarding` walk grouped sub-block leaves — any FUTURE key must again be added to both locales in the same change, or those suites (and the `*Labels` gate) will fail.
- **Environment carry-forward (confirms A2, sharpens it):** full-repo tsgo OOM is deterministic (3/3 attempts; needs ~3 GB RSS vs ~3.0 GB available with the dev server up). Sub-loop's tsgo stage silently false-passes on OOM — later tasks MUST NOT treat "sub-loop exit 0" as type-safety evidence. Recommended pattern (used here): scoped `tsgo -p <temp-config extending root tsconfig, include=touched files, incremental:false, types:[]> --noEmit` + one deliberate negative-control run to prove gate engagement; the three `types/` files alone can use the mandated `--ignoreConfig` form (no imports → complete proof).
- Branch anomaly A1 persists (HEAD on `main`); no commits were made by this subagent per hard rules.
