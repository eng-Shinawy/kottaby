/**
 * Apollo engine factory for the `/api/graphql` gateway — extracted from
 * `app/api/graphql/route.ts` (oversized-file split). This module owns the
 * ApolloServer construction (plugins, disclosure flags, error-format hop);
 * the route owns environment validation and passes the env-derived flags in
 * via {@link ApolloEngineOptions} so the code-explicit `NODE_ENV` gate
 * literals stay source-pin locked route-side. Behavior is unchanged from the
 * pre-extraction route.
 */

import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginLandingPageDisabled } from "@apollo/server/plugin/disabled";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import type { GraphQLSchema } from "graphql";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { createGraphqlErrorsFinalizerPlugin } from "@/backend/graphql/graphqlErrorsFinalizer";
import { attachRawErrorHop } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";

/**
 * Env-derived engine flags, computed ONCE by the route module from the
 * validated environment config. The factory consumes them non-ambiently —
 * it never reads `process.env` itself. `introspection` IS
 * `NODE_ENV !== "production"` (route-side code-level constant).
 */
export interface ApolloEngineOptions {
  readonly introspection: boolean;
  readonly isProduction: boolean;
}

export function createApolloServer(schema: GraphQLSchema, engineOptions: ApolloEngineOptions): ApolloServer<Context> {
  const { introspection, isProduction } = engineOptions;
  return new ApolloServer({
    schema,
    plugins: [
      // THE single error-finalization registration site.
      // `finalizeGraphqlErrors` runs exactly once per execution result at
      // `willSendResponse`, BEFORE serialization: DomainError pass-through
      // (localized message + subclass code + path, ctx.requestId attached),
      // deep DB-conflict translation reused from backend/lib/errors, and
      // everything else masked behind the localized INTERNAL_SERVER_ERROR
      // item with exactly one redacted correlated logger.error. See
      // backend/graphql/graphqlErrorsFinalizer.ts for the full contract.
      createGraphqlErrorsFinalizerPlugin(),
      isProduction
        ? ApolloServerPluginLandingPageDisabled()
        : ApolloServerPluginLandingPageLocalDefault({ footer: false }),
    ],
    hideSchemaDetailsFromClientErrors: isProduction,
    includeStacktraceInErrorResponses: !isProduction,
    logger: logger,
    // Introspection flag composition — the code-explicit gate literal itself
    // (`introspection: !isProduction`) lives in the route module where the
    // health-probe source pins are locked; this factory only consumes it.
    introspection,
    // Allow array-batched HTTP requests — the frontend Apollo Client uses
    // BatchHttpLink which groups concurrent operations into a single POST
    // (JSON array body). Without this, the server rejects batched requests
    // with "Operation batching disabled" and the browser's useQuery calls fail.
    allowBatchedHttpRequests: true,
    //
    // Apollo ≥5 formats every execution/parse/validation error through
    // `GraphQLError.toJSON()` BEFORE `willSendResponse`, so
    // items there are PLAIN objects with no reference to the thrown value.
    // This hook therefore performs EXACTLY ONE boundary duty: attaching the
    // raw throwable to its formatted item via the non-enumerable envelope hop
    // (`attachRawErrorHop`) that `finalizeGraphqlErrors` classifies through.
    // ALL response-level formatting/classification decisions — DomainError
    // pass-through (localized message + subclass code + path), requestId
    // attachment, protocol-preset pass-through, INTERNAL_SERVER_ERROR masking
    // + correlated logging — are owned EXCLUSIVELY by the registered plugin
    // above. One classifier, one registration site, zero double-formatting.
    formatError: (formattedError, error) => {
      const item = { ...formattedError };
      attachRawErrorHop(item, error);
      return item;
    },
  });
}
