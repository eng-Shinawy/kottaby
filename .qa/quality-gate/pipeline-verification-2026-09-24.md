# Pipeline verification — academic-tracking branch (2026-09-24)

## Scope

Full local pipeline run on `feat/admin-academic-tracking` (base: `c3cab46`),
matching the CI quality + test stages: db migrate/seed, GraphQL schema/codegen
drift, the three test suites, and every quality-gate stage.

## Commands and results

| Command | Result |
|---|---|
| `bun db migrate` (dev, pglite) | OK — all migrations applied |
| `bun db seed` (dev, pglite) | OK — standard profile |
| `bun db migrate` + `bun db seed` (test DB) | OK — minimal profile, mirrors `ci.yml` step order |
| `bun run generate:gqlSchema` | OK — `schema.graphql` 53810 bytes, no drift |
| `bun run codegen` | OK — zero diff after regeneration |
| `bun run test:db` | **950/950 passed** (49 files) |
| `bun run test:services` | **1713/1713 passed** (73 files) |
| `bun run test:graphql` | **218/218 passed** (14 files) — real warm-server run, zero skips |

## Quality-gate stages

| Stage | Result |
|---|---|
| `bun tsgo` | PASS (full repo) |
| `bun biome:check` | PASS (2332 files; fixes confined to untracked sandbox rig) |
| `bun check:unused` (knip) | PASS |
| `bun check:duplicates` | PASS — 0 clones, no `jscpd:ignore` |
| `bun run oxlint` (type-aware) | PASS — verified per-directory (all dirs "0 warnings and 0 errors") |
| `bun lint:type-aware` | PASS — verified per-directory with warmed `.eslintcache-type-aware`; full-repo run verified clean before the final refactor commits |

## Sandbox RAM note

The 4 GB sandbox cgroup OOM-kills the full-repo type-aware checkers
(`tsgolint` headless peaks ~2.9 GB; the type-aware ESLint child exceeds its
~2.9 GB clamped heap on the whole repo at once). This is a known
sandbox-infrastructure limitation — see the `QUALITY_GATE_SETTLE_MS` note in
`scripts/quality-gate.ts` and `test/helpers/skip-when-pglite.ts`. Both stages
were therefore verified in bounded per-directory batches (zero violations in
every batch); CI runs both full-repo authoritatively on larger runners.

## GraphQL suite execution note

`test:graphql` requires a real multi-connection PostgreSQL shared by the test
process and the warm Next.js dev server. Under in-process PGlite the suite
skips by design (`describeGraphqlSuite`). Locally it was executed against
PGlite exposed over the Postgres wire protocol (batch-atomic, transaction-
affinity wire bridge), producing a genuine 218-test run against the warm
server. CI runs the suite against a real `postgres:16` service container.
