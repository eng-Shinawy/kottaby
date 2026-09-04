import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets parallel servers use separate dist dirs — Next.js 16
  // locks the dist dir (`<distDir>/lock`) at `next dev` startup, so a test
  // server (`.next-test-dev`/`.next-test-prod`) must not share the dev
  // server's dist dir or it refuses to start ("Another next dev server is
  // already running"). All test/build scripts already export NEXT_DIST_DIR;
  // plain `bun run dev` keeps the default `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["*.space-z.ai", "*.space-zai"],
  // Dev-only polish: hide the floating Next.js dev-tools indicator (the "N"
  // badge parked bottom-left in every dev capture — visual QA kept flagging
  // it as an overlapping artifact on production-looking screenshots; it has
  // no effect on production builds).
  devIndicators: false,
  experimental: {
    // TypeScript 7.0.2's `lib/tsc.js` is an ESM module that cannot be loaded
    // by Next.js's runTypeScriptCli (which uses require/child_process).
    // Setting `useTypeScriptCli: false` makes Next.js use the `lib/typescript.js`
    // API path instead, which works correctly with the TS6 shim installed by
    // @typescript/typescript6. This fixes the "Could not parse output from
    // TypeScript's --showConfig" error in Storybook.
    useTypeScriptCli: false,
  },
  // Treat PGlite + pg + drizzle + jose + bcryptjs as Node-only externals.
  // These packages ship .wasm / native bindings / `import.meta.url`-relative
  // asset paths that webpack's bundler cannot reproduce at runtime.
  // `serverExternalPackages` keeps them outside the server bundle
  // (`require('pg')` resolves to the real Node module at runtime) — this is
  // the canonical Next.js 16 way to opt out of bundling for server-side
  // dependencies that depend on Node built-ins (fs, worker_threads, crypto,
  // WASM file loading via import.meta.url).
  // Without this, the sandbox `DB_PROVIDER=pglite` path fails inside the
  // webpack-bundled `/api/graphql` route because PGlite's WASM loader
  // (`fs.readFile(new URL('./pglite.wasm', import.meta.url))`) hits the
  // webpack fs polyfill which doesn't accept URL inputs.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "pg-protocol",
    "pg-pool",
    "drizzle-orm",
    "bcryptjs",
    "jose",
    "newrelic",
  ],
};

export default nextConfig;
