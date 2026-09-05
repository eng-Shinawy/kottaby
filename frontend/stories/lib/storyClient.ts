import { ApolloClient } from "@apollo/client";
import { MockLink } from "@apollo/client/testing";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";

/**
 * Shared Storybook harness for GraphQL-backed stories.
 *
 * Every story builds a real `ApolloClient` on `MockLink` with the production
 * cache (same normalization behavior as the app). Kept in a non-component
 * module so story files get a single, lint-clean import site.
 */

/** Creates the mocked Apollo client for a story. */
export function createStoryApolloClient(mocks: readonly MockLink.MockedResponse[]): ApolloClient {
  return new ApolloClient({
    link: new MockLink([...mocks]),
    cache: createApolloCache(),
    defaultOptions: { query: { errorPolicy: "none" } },
  });
}
