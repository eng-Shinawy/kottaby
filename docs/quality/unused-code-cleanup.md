# Unused-Code Cleanup — Knip Patterns, Blind Spots & Memory-Constrained Hosts

Canonical reference for running and extending the repo's unused-code analysis (`check:unused` / knip), the deletion-safety protocol, and the quality-gate playbook for memory-constrained hosts. Consolidated from the `clean_unused` plan implementation (all patterns battle-tested across its phases and review waves).

## 1. Running knip — the Bun invocation rule

```bash
bun run check:unused        # package.json script: bun node_modules/knip/bin/knip-bun.js
```

**knip MUST run under Bun's runtime on memory-constrained hosts.** The default node shebang path (`bunx knip` / plain `node`) crashes with `RangeError: Array buffer allocation failed` — oxc-parser's raw transfer wants a ~6.4 GB ArrayBuffer; hosts with ~4 GB and no swap die. `knip-bun.js` disables raw transfer under Bun.

- The JSON reporter omits configuration hints — always run the default reporter when hints matter.
- knip exits 1 while findings exist; exit 0 with only informational extension hints (`.mdx`/`.css` "compiled extension excluded by project") is the terminal clean state.

## 2. knip blind spots — verify before deleting (deletion-safety protocol)

knip's import graph cannot see several reference forms. Every flagged finding is a *candidate*, never proof. Before deleting any file or symbol, grep for:

1. **Path-minus-extension** (`path/to/file`) AND **directory form** for `index.ts` barrels (`some/dir"`, `some/dir/`)
2. **String dynamic imports**: `import(.*file-name`, template-literal specifiers
3. **`X.member` access** — same-class receiver only (same-named methods on other classes don't count)
4. **Destructured dynamic imports**: `const { Svc } = await import(...)`
5. **Generic factory parameter consumption**: `buildX(Repository)` where call sites use `repo.listAll(...)`
6. **Type positions**: `satisfies <Type>`, narrowing, `as` casts, generic type arguments
7. **Path-string invocations** — the wrapper blindness: any file invoked as an argument inside `run-locked-cmd.ts <label> <cmd> <file>` is invisible to knip (package.json script analysis sees only the outer command). Same for `--preload` flags and framework-convention globs (Storybook stories, drizzle configs, codegen sharedDocuments).

### Protected symbol classes (never silent-delete)

| Class | Remedy | Evidence pattern |
|---|---|---|
| Pothos `*PothosObject` exports | drop `export` keyword, keep the object | side-effect schema registration via builder chaining in-file |
| DB/GraphQL-backed enum members | documented directory-level knip **ignore** | pgEnum string values in `backend/db/schema` + drizzle migrations; Pothos enum registration |
| Generator outputs (e.g. `shared/constants/iana-timezone*.ts`) | knip ignore with justification | output paths hardcoded in the generator (`scripts/iana-timezone-generator/paths.ts`) |
| Path-invoked scripts | knip **entry** (never ignore) | wrapper args, `--preload`, documented AI runner commands |
| Type-only exports in signature positions of live functions | knip-accepted (leave) | zero direct importers but used in exported signatures — knip counts these as used |

Every `entry`/`ignore`/`ignoreDependencies` addition in `knip.config.ts` carries a one-line justification comment citing its evidence — never a bare suppression.

## 3. Unused-dependency verification

Before removing a package, grep ALL reference surfaces: package.json scripts (including nested wrapper args), `.github/workflows/`, tool configs (`next.config.ts`, `codegen.ts`, `.storybook/main.ts`, `eslint.config.mjs`, `bunfig.toml`, `drizzle.config*.ts`, `tsconfig.json` `types` array), bin invocations inside `scripts/**`, node_modules file-path access (e.g. cldr data files), and docs. Config-string-referenced packages (newrelic, codegen plugins, storybook addons, the tsgo toolchain) belong in `ignoreDependencies` with a justification — not uninstall.

Conversely, packages removed from package.json must take their `ignoreDependencies` entries with them in the same changeset — a stale entry for an uninstalled package is a config hint.

## 4. Quality-gate on memory-constrained hosts (~4 GB, no swap)

The gate chain (tsgo → oxlint type-aware → biome → lint:type-aware → jscpd) has two memory cliffs:

- **`tsgolint`** (oxlint's type-aware Rust binary) needs ~2.5 GB free. Pause long-lived dev servers during the gate run; standalone `bun run oxlint` passes in ~18 s when memory is available.
- **`lint:type-aware` full-repo** needs >2.5 GB V8 heap for the TypeScript program (V8 aborts below ~2.6 GB; the kernel OOM-kills at ~2.9 GB heap + overhead on a 4 GB host). Resolution: **chunked cache-warming** — run the file-scoped CLI over 100-file chunks (`bun run scripts/lint-service.ts --type-aware -f a.ts -f b.ts ...`; all chunks exit 0) to populate `.eslintcache-type-aware`, after which the full-repo run passes because ESLint skips cached files. Tune the child heap with `LINT_MAX_OLD_SPACE_MB` — the lint service's own documented env override for constrained hosts (its error message recommends exactly this).
- **One-shot CLI scripts that import barrels with singleton side-effects must `process.exit(0)` explicitly** — e.g. `scripts/restore-next-env-dts.ts` importing through `@/scripts/lib` constructs the PGlite pool under `DB_PROVIDER=pglite`, keeping the event loop alive forever. Symptom: script prints success then hangs (exit 124 under `timeout`).
- **Cgroup-sandbox OOM (tsgolint SIGKILL) — no bypass exists.** Inside a small cgroup (~4 GB, no swap), `bun quality-gate`'s BASIC_CHECKS oxlint run is OOM-killed (SIGKILL) during the `tsgolint` type-aware companion run itself — the repo's `scripts/quality-gate.ts` documents this exact failure mode and ships `QUALITY_GATE_SETTLE_MS` as the sanctioned settle-time mitigation, which does NOT help when tsgolint is killed mid-run. oxlint hard-requires the companion (removing it → "Failed to find tsgolint executable"), so the composite gate simply cannot complete on such hosts. Sanctioned posture: run every constituent stage that CAN run individually and record their counts; document the composite-gate failure as a host limitation.
- **Pristine-main attribution protocol (applies to ANY gate/test failure).** Before attributing a failure to your changeset — or excusing it as pre-existing — reproduce it on a pristine `origin/main` worktree with zero of your files present. Byte-for-byte reproduction there (same exit, same counts) proves the failure pre-exists your diff; a clean pristine-main run means your diff caused it and you fix it. Pair the protocol with per-stage runs (above) so each stage's evidence is individually citable. This is how a sandbox-only quality-gate OOM and a deterministically failing chaos test were both proven out-of-scope without touching the ledger's semantics.

## 5. Second-order convergence

Deletions cascade: removing an export orphans its barrel line; removing the barrel orphans the file; removing the file orphans its dependencies. Re-run `bun run check:unused` after each wave and fix new findings until it exits 0 — orphans surfaced one full phase after their cause in practice. Own-file-only symbols keep the symbol and drop the `export` keyword; genuinely-unreferenced declarations go with their JSDoc.

## 6. Review-wave findings taxonomy (what actually breaks)

Across four independent review iterations over a deletion-only changeset (~200 files, −6.8k lines): **zero code-behavior defects**. Real findings were (a) missed export-drops on zero-consumer type exports, (b) stale doc/AGENTS pointers to deleted symbols, (c) phantom config/env blocks. Static gates (tsgo) prove import integrity; the residue class is *documentation truthfulness* — budget a docs wave after any large deletion pass.
