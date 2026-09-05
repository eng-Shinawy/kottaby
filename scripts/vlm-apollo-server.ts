/**
 * Standalone Apollo HTTP server for VLM-based functional verification of
 * DEV3-017 account governance.
 *
 * Bypasses Next.js (the dev server crashes on this sandbox) by using
 * `@apollo/server`'s `startStandaloneServer` directly with the project's
 * existing `graphQLSchema` + `createGraphQLContext`.
 *
 * Runs on http://0.0.0.0:4000/graphql
 *
 * Usage: bun run scripts/vlm-apollo-server.ts
 */
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { createGraphQLContext } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { ensureEnvironmentValidated } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";

ensureEnvironmentValidated();

const server = new ApolloServer({
  schema: graphQLSchema,
  introspection: true,
  formatError: formatted => {
    // Pass through; Apollo's default envelope is correct for our wire-tier matrix
    return formatted;
  },
});

const PORT = Number(process.env.VLM_APOLLO_PORT ?? 4000);

const { url } = await startStandaloneServer(server, {
  listen: { host: "0.0.0.0", port: PORT },
  context: async ({ req }) => {
    // Apollo standalone passes a Node IncomingMessage; the project's
    // createGraphQLContext expects a WHATWG Request. Bridge by constructing
    // a fetch Request from the IncomingMessage headers + URL.
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) {
        for (const vv of v) headers.append(k, vv);
      }
    }
    const request = new Request(`http://localhost:${PORT}/graphql`, {
      method: req.method ?? "POST",
      headers,
    });
    const ctx = await createGraphQLContext(request);
    return ctx;
  },
});

logger.info(`[vlm-apollo-server] 🚀 Ready at ${url}graphql`);
console.log(`\n[vlm-apollo-server] 🚀 Ready at ${url}graphql\n`);
