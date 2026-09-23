"use client";

/**
 * DirectoryMobileCardList — the shared mobile (< md) rendering of the
 * admin directory surfaces (students / teachers / applicants): a vertical
 * stack of the domain's per-item cards (16px gap) separated from the
 * pagination card by a single 24px gap.
 *
 * Loading renders stable-key skeleton cards (announced through the
 * localized loading label); the empty state renders the domain's node
 * wrapped in the standard card.
 */

import { Box, Card, Stack } from "@mui/material";
import type { ReactElement, ReactNode } from "react";
import { directoryPanelCardSx, directorySkeletonCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";

/** Skeleton cards rendered while the first page is in flight. */
const SKELETON_CARD_COUNT = 4;

interface DirectoryMobileCardListProps {
  readonly loading: boolean;
  /** Announced by the skeleton stack while the first page is in flight. */
  readonly loadingLabel: string;
  /** Stable skeleton card keys (the domain's `*_SKELETON_KEYS`). */
  readonly skeletonKeys: readonly string[];
  /** Empty-state node, wrapped in the standard card. */
  readonly empty: ReactNode;
  /** The domain's mapped per-item cards. */
  readonly cards: readonly ReactElement[];
}

export function DirectoryMobileCardList(props: DirectoryMobileCardListProps): ReactNode {
  const { loading, loadingLabel, skeletonKeys, empty, cards } = props;
  return (
    <Stack
      spacing={2}
      sx={{ display: { xs: "flex", md: "none" }, paddingBlockEnd: 3 /* one 24px gap before the pagination card */ }}
    >
      {loading && cards.length === 0 ? (
        <Box component="output" aria-busy="true" aria-label={loadingLabel} sx={{ display: "contents" }}>
          <Stack spacing={2}>
            {skeletonKeys.slice(0, SKELETON_CARD_COUNT).map(rowKey => (
              <Card key={rowKey} sx={directorySkeletonCardSx()} />
            ))}
          </Stack>
        </Box>
      ) : null}
      {!loading && cards.length === 0 ? <Card sx={directoryPanelCardSx()}>{empty}</Card> : null}
      {cards}
    </Stack>
  );
}
