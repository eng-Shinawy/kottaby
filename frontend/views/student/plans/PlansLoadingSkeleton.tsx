"use client";

import { Box, Paper, Skeleton, Stack } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { PLANS_SKELETON_TEST_ID } from "@/frontend/views/student/plans/plansViewIds";

/**
 * PlansLoadingSkeleton — the loading branch: card-shaped skeleton rows
 * mirroring the loaded plan-card anatomy block for block (title line,
 * prominent price bar, the sessions + validity chip-pill pair, a body
 * line, and the full-width Buy CTA). The last row is a deliberately
 * truncated stub — the viewport fold cuts it mid-card, so the shorter
 * partial keeps the cut-off reading as intentional. The region announces
 * itself politely through `Paper component="output"` + `aria-busy` (the
 * MUI v9 aria-live pattern).
 */

/** Stable keys for the two full-card rows (never keyed off render order). */
const FULL_ROW_KEYS: readonly string[] = ["plan-card-row-a", "plan-card-row-b"];

/** Chip-pill height — the loaded card's `size="small"` Chip geometry. */
const CHIP_PILL_HEIGHT = 24;

/** Chip-pill widths — the sessions + validity pair. */
const CHIP_PILL_WIDTHS: readonly number[] = [112, 88];

/** CTA bar height — the loaded Buy button's `minHeight: 44`. */
const CTA_BAR_HEIGHT = 44;

interface SkeletonBarProps {
  readonly variant: "text" | "rounded";
  readonly height: number;
  readonly width: number | string;
  readonly pill?: boolean;
  readonly emphasis?: boolean;
}

/**
 * One placeholder bar, raised one surface step above the Skeleton default
 * tone so the bars read clearly against the surrounding container.
 */
function SkeletonBar({
  variant,
  height,
  width,
  pill = false,
  emphasis = false,
}: Readonly<SkeletonBarProps>): React.ReactElement {
  return (
    <Skeleton
      variant={variant}
      height={height}
      width={width}
      sx={theme => ({
        bgcolor: emphasis ? alpha(theme.palette.primary.main, 0.28) : theme.palette.surfaceContainerHighest,
        borderRadius: pill ? 999 : undefined,
      })}
    />
  );
}

/** One card-shaped skeleton row mirroring the loaded PlanPurchaseCard anatomy. */
function PlanCardSkeletonRow({ truncated = false }: Readonly<{ truncated?: boolean }>): React.ReactElement {
  return (
    <Box
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        p: 1.5,
        display: "grid",
        gap: 1.5,
      })}
    >
      <SkeletonBar variant="text" height={28} width="45%" />
      <SkeletonBar variant="text" height={40} width="30%" />
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        {CHIP_PILL_WIDTHS.map(width => (
          <SkeletonBar
            key={`chip-pill-${String(width)}`}
            variant="rounded"
            pill
            height={CHIP_PILL_HEIGHT}
            width={width}
          />
        ))}
      </Stack>
      {truncated ? null : (
        <>
          <SkeletonBar variant="text" height={16} width="55%" />
          <SkeletonBar variant="rounded" height={CTA_BAR_HEIGHT} width="100%" emphasis />
        </>
      )}
    </Box>
  );
}

export function PlansLoadingSkeleton(): React.ReactElement {
  return (
    <Paper
      component="output"
      data-testid={PLANS_SKELETON_TEST_ID}
      aria-busy="true"
      elevation={0}
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        p: 2,
      })}
    >
      <Stack sx={{ gap: 2 }}>
        {FULL_ROW_KEYS.map(key => (
          <PlanCardSkeletonRow key={key} />
        ))}
        <PlanCardSkeletonRow truncated />
      </Stack>
    </Paper>
  );
}
