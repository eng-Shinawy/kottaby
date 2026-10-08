"use client";

/**
 * TeacherDirectoryRequestDialog.credits.parts — the prepaid-credits strip
 * of the request-session dialog (the `*.parts.tsx` convention), extracted
 * to keep the host file lean: the localized strip label over FOUR
 * outlined lane chips (trial / hifz / tajweed / reviews) plus the honest
 * MAY-decline caption when the selected intent's prepaid lanes are empty.
 *
 * Pure presentational — no hooks, no GraphQL: the caller passes the
 * already-resolved balance payload (`null` while the read is loading or
 * failed — the strip renders NOTHING in both states: silent honest
 * degradation, booking still works) plus the dialog's selected intent
 * (`null` while no subject is chosen yet — an un-narrowed applied browse
 * filter: no chip is emphasized and the insufficiency caption is withheld
 * until a subject is picked).
 *
 * Wire-null lanes coalesce to 0 for display: only `balanceTrial` is a
 * NOT NULL column — the three purchased lanes are nullable columns
 * surfaced honestly on the wire, and a null lane record carries no
 * credits (same presentation rationale as the dashboard's credits sum).
 *
 * The chip matching the SELECTED intent (fail-closed `CREDIT_LANE_BY_INTENT`
 * Record) renders tinted/emphasized; while NO subject is selected
 * (`selectedIntent === null`) every chip renders plain. When the selected
 * intent's EFFECTIVE credits are 0 — `balanceTrial + selected lane`,
 * because the server's trial-first debit ladder (`debitBookingLadder` in
 * `backend/services/classes/session-lifecycle.booking.ts`) spends the trial
 * lane before the intent lane — the chip tints with the error-container
 * palette and ONE muted caption states the booking MAY be declined for
 * insufficient credits. The server remains authoritative: subscription
 * coverage is NOT probed by this strip, so a zero prepaid read is a
 * warning, never a verdict. MUI v9 `sx`-only, theme-palette colors, RTL-safe.
 */

import { Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { type MySessionBalanceQuery_mySessionBalance, SessionIntent } from "@/frontend/graphql/generated/gql/graphql";
import type { BrowseIntent } from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import type { TeacherDirectoryLabels } from "@/shared/locale/types/teacherDirectory";

/** The four prepaid credit lanes the strip renders, in display order. */
type CreditLaneKey = "trial" | "hifz" | "tajweed" | "reviews";

/** The `TeacherDirectoryLabels` keys holding one label per credit lane. */
type CreditLaneLabelKey = keyof Pick<
  TeacherDirectoryLabels,
  "creditLaneTrial" | "creditLaneHifz" | "creditLaneTajweed" | "creditLaneReviews"
>;

/** Fixed lane display order: the trial lane first (the debit ladder's head), then the purchased lanes. */
const CREDIT_LANES: readonly CreditLaneKey[] = ["trial", "hifz", "tajweed", "reviews"];

/** Lane → the `TeacherDirectoryLabels` key holding its localized label. */
const LANE_LABEL_KEY: Record<CreditLaneKey, CreditLaneLabelKey> = {
  trial: "creditLaneTrial",
  hifz: "creditLaneHifz",
  tajweed: "creditLaneTajweed",
  reviews: "creditLaneReviews",
};

/**
 * Lane → display-count resolver — the nullable purchased lanes coalesce
 * to 0 (a null lane record carries no credits); the trial lane is NOT NULL.
 */
const LANE_COUNT: Record<CreditLaneKey, (balance: MySessionBalanceQuery_mySessionBalance) => number> = {
  trial: balance => balance.balanceTrial,
  hifz: balance => balance.balanceHifz ?? 0,
  tajweed: balance => balance.balanceTajweed ?? 0,
  reviews: balance => balance.balanceReviews ?? 0,
};

/**
 * Selected browse intent → its own credit lane (the fail-closed Record
 * idiom: every `BrowseIntent` member is tabled, so nothing can fall through).
 */
const CREDIT_LANE_BY_INTENT: Record<BrowseIntent, Exclude<CreditLaneKey, "trial" | "reviews">> = {
  [SessionIntent.Hifz]: "hifz",
  [SessionIntent.Tajweed]: "tajweed",
};

interface RequestCreditsStripProps {
  /** The resolved balance payload (`null` = loading or failed → render nothing). */
  readonly balance: MySessionBalanceQuery_mySessionBalance | null;
  /** The dialog's currently selected subject intent (`null` = none chosen yet). */
  readonly selectedIntent: BrowseIntent | null;
  /** Compile-time localized copy handles (property access only). */
  readonly labels: TeacherDirectoryLabels;
}

/** The request dialog's prepaid-credits strip — see the module docblock. */
export function RequestCreditsStrip({
  balance,
  selectedIntent,
  labels,
}: Readonly<RequestCreditsStripProps>): ReactNode {
  if (balance === null) {
    // Loading or failed read — the strip renders nothing (silent honest
    // degradation; booking still works, the server remains authoritative).
    return null;
  }
  // No subject chosen yet (an un-narrowed applied filter): no lane to
  // emphasize and none to warn about — the four chips render plain and
  // the insufficiency caption is withheld until a subject is picked.
  const selectedLane = selectedIntent === null ? null : CREDIT_LANE_BY_INTENT[selectedIntent];
  // Effective credits for the selected intent: the debit ladder spends the
  // trial lane FIRST, then the intent lane — so both must be empty for the
  // prepaid surface to read zero (subscription coverage is not probed here).
  const effectiveCredits = selectedLane === null ? null : LANE_COUNT.trial(balance) + LANE_COUNT[selectedLane](balance);
  const insufficient = effectiveCredits === 0;
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography
        variant="caption"
        sx={theme => ({
          color: theme.palette.text.secondary,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        })}
      >
        {labels.requestDialogCreditsLabel}
      </Typography>
      <Stack sx={{ flexDirection: "row", flexWrap: "wrap", gap: 1 }}>
        {CREDIT_LANES.map(lane => {
          const selected = lane === selectedLane;
          const warn = selected && insufficient;
          return (
            <Chip
              key={lane}
              label={`${labels[LANE_LABEL_KEY[lane]]} ${LANE_COUNT[lane](balance)}`}
              variant="outlined"
              sx={theme => {
                if (warn) {
                  return {
                    borderColor: theme.palette.errorContainer,
                    bgcolor: theme.palette.errorContainer,
                    color: theme.palette.onErrorContainer,
                  };
                }
                if (selected) {
                  return {
                    borderColor: theme.palette.primary.main,
                    bgcolor: theme.palette.primaryContainer,
                    color: theme.palette.onPrimaryContainer,
                  };
                }
                return { borderColor: theme.palette.outlineVariant, color: theme.palette.onSurfaceVariant };
              }}
            />
          );
        })}
      </Stack>
      {insufficient ? (
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
          {labels.requestDialogInsufficientCreditsNote}
        </Typography>
      ) : null}
    </Stack>
  );
}
