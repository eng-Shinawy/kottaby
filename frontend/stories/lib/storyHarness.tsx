import { ApolloProvider } from "@apollo/client/react";
import type { MockLink } from "@apollo/client/testing";
import { Container } from "@mui/material";
import { type ReactNode, useState } from "react";
import { createStoryApolloClient } from "@/frontend/stories/lib/storyClient";

/**
 * Wraps story content with a stable Apollo provider built from the given
 * mocks. The client is created once per mounted story so React re-renders
 * never rebuild it mid-tree.
 */
export function StoryApolloProvider({
  mocks,
  children,
}: Readonly<{ mocks: readonly MockLink.MockedResponse[]; children: ReactNode }>): ReactNode {
  const [client] = useState(() => createStoryApolloClient(mocks));
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

/**
 * Mirrors the dashboard shell's content frame (`DashboardLayout`'s
 * `<Container maxWidth="xl" sx={{ py: ... }}>`) — page-level stories render
 * without the real layout, so their content would sit flush against the
 * canvas edges. Wrap the page view in this frame (inside the providers) to
 * reproduce the shell's vertical rhythm and horizontal gutters.
 */
export function DashboardStoryFrame({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, sm: 3, md: 4 } }}>
      {children}
    </Container>
  );
}
