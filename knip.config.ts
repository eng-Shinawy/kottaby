import type { KnipConfig } from "knip";

/**
 * Knip unused-code / unused-dependency analysis.
 * Prefer `knip.config.ts` over `knip.ts` so `import … from "knip"` resolves to the package.
 *
 * Next.js, Storybook, Bun test, ESLint, Biome, and Drizzle plugins auto-detect their own
 * entry files; `entry` / `project` below set the analysis scope for this monorepo layout.
 */
const config: KnipConfig = {
  entry: [
    "app/**/page.tsx",
    "app/**/layout.tsx",
    "app/**/route.ts",
    "scripts/**/*.ts",

    // Backend DB seed & migration runners — invoked via `bun run` / `drizzle-kit`,
    // they are the import-graph root for 100+ backend/db/seeds/** files
    "backend/db/scripts/**/*.ts",
    "backend/db/seeds/index.ts",

    // GraphQL schema side-effect registration — `import "@/backend/graphql/pothos"`
    // registers all Pothos types by side-effect (no named imports from the call site)
    "backend/graphql/gqlSchema.definitions.ts",
    "backend/graphql/pothos/index.ts",
    "backend/graphql/pothos/parents/parent-monitoring.pothos.ts",
    "backend/graphql/query/index.ts",
    "backend/graphql/mutation/index.ts",

    // Bun --preload test roots — loaded via `bun test --preload <file>` CLI flag,
    // never statically imported (package.json script: test:ui:e2e:paymob)
    "test/ui/test-env.ts",

    // Bun test runners invoked by path string only (run-locked-cmd wrapper args
    // in package.json scripts + the AGENTS.md-documented AI runner) — knip
    // cannot see nested wrapper commands.
    "test/scripts/build-test.ts",
    "test/scripts/run-server-tests.ts",
    "test/scripts/run-test.ts",
  ],
  project: [
    "app/**/*.{ts,tsx}",
    "backend/**/*.{ts,tsx}",
    // `mdx` covers the Storybook addon-docs compiler registered by the knip Storybook
    // plugin — project patterns must include the compiled extension so imports in
    // future .mdx files are followed (keeps --treat-config-hints-as-errors clean).
    "frontend/**/*.{ts,tsx,mdx}",
    "shared/**/*.{ts,tsx}",
    "scripts/**/*.{ts,tsx}",
    "test/**/*.{ts,tsx}",
  ],
  ignore: [
    "!.storybook/**",
    "**/generated/**",

    // Storybook story aggregation — re-exports *.stories.tsx, accessed only by
    // @storybook/react plugin globbing, never by app code
    "frontend/stories/**",

    // Auto-generated IANA timezone catalog (ids/labels/territories/enum) — outputs of
    // `generate:iana-timezones` (scripts/iana-timezone-generator/paths.ts). Consumed via
    // Object.values() + the codegen IanaTimezone scalar mapping; members are never
    // referenced by name. Regenerated deterministically — never hand-edit, never delete.
    "shared/constants/iana-timezone*.ts",

    // DB/GraphQL-schema-backed enums — member/export usage is invisible to knip's
    // import graph (values live as pgEnum string literals in the schema + migrations,
    // or the whole enum is registered with Pothos). Grep-verified per file:
    //   - register-public-role: whole enum registered as the GraphQL
    //     `RegisterPublicRole` type (backend/graphql/pothos/shared/enum.pothos.ts)
    //     — all three members are schema-exposed.
    //   - surah-juz-ref: REMOVED from this list — the enum is now live in the
    //     import graph (registered with Pothos in enum.pothos.ts, consumed by
    //     home-work.pothos.ts + the session-report guards), so knip resolves it
    //     natively and an ignore entry would only be a stale-config hint.
    //   - recitation-reading: documented backend re-export shim of the canonical
    //     shared enum (docs/auth/qiraah-selection-and-c5.md) — an intentional
    //     @/backend/enum import-path alias, not a second value list.
    "backend/enum/shared/recitation-reading.enum.ts",
  ],

  // Dependencies that are genuinely used but invisible to knip's import graph.
  // Each entry has a functional reference (config string, bin invocation, file-path
  // access, or docs-mandated runtime) — grep-verified before registration.
  ignoreDependencies: [
    // jscpd: bin invoked through the `check:duplicates` script wrapper (knip cannot
    // see binaries nested inside run-locked-cmd.ts arguments).
    "jscpd",
    // @cspell/dict-ar: dictionary loaded by cspell.config.yaml
    // (`@cspell/dict-ar/cspell-ext.json`) — config-string reference, never imported.
    "@cspell/dict-ar",
    // newrelic: string in next.config.ts `serverExternalPackages` + the newrelic.cjs
    // agent config + NEW_RELIC_* env surface (agent is require()d by the runtime,
    // not imported by app code).
    "newrelic",

    // @pothos/plugin-dataloader + dataloader: canonical batching pattern mandated
    // by docs/graphql/dataloader-batching.md + backend AGENTS.md ("t.loadable() for
    // any per-parent field") — no static registration yet by design.
    "@pothos/plugin-dataloader",
    "dataloader",

    // @typescript/native-preview: provides the `tsgo` bin (node_modules/.bin/tsgo)
    // used by CI, the quality gate, and scripts/health/*.
    "@typescript/native-preview",

    // @typescript/typescript6: required by literal path in scripts/ts6-eslint-patch.cjs
    // (swaps eslint's typescript for the TS6 shim) + next.config.ts useTypeScriptCli.
    "@typescript/typescript6",
    // cldr-*: raw JSON files read via node_modules/... file paths by the IANA
    // timezone generator (scripts/iana-timezone-generator/paths.ts).
    "cldr-core",
    "cldr-dates-full",
    "cldr-localenames-full",

    // pg-connection-string: test-only parity oracle for the perf-harness DB
    // target guard (scripts/perf/lib/db-target-guard.test.ts imports the REAL
    // parser `pg` uses to prove the guard resolves exactly the database the
    // driver would connect to). The guard module itself has no dependency on
    // it; it stays a transitive dep of pg.
    "pg-connection-string",
  ],
};

export default config;
