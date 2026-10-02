"use client";

/**
 * Admin academic-tracking honest empty surfaces.
 *
 * Two empty arms exist, and they are NEVER interchangeable:
 *  - the dashboard's zero-row state, split by cause — no students exist at
 *    all vs. the current search matched nothing (the filtered arm invites
 *    a different term, the unfiltered arm explains when rows appear);
 *  - the drill-down's per-section zero-history state (homework / session
 *    reports), rendered inside a section card.
 *
 * Single-track honesty (a student with only one Jadid/Madi lane populated)
 * is NOT an empty state — those rows render inline with their dedicated
 * none-assigned labels; only genuinely zero-row scopes land here.
 *
 * Presentational only: label text is resolved by the caller. MUI v9
 * discipline: `sx`-only styling, theme-palette tokens, `*Outlined` icons.
 */

import { PersonOffOutlined, SearchOffOutlined } from "@mui/icons-material";
import { Box, Card } from "@mui/material";
import type { ReactNode } from "react";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

type AcademicTrackingEmptyVariant = "unfiltered" | "filtered";

interface AcademicTrackingEmptyStateProps {
  /** Which zero-row cause the dashboard is honestly reporting. */
  readonly variant: AcademicTrackingEmptyVariant;
  readonly labels: AdminAcademicLabels;
}

/**
 * The dashboard's zero-row state — the cause-split title/body pair over
 * the shared icon-circle composition (a distinct icon per cause so the
 * two arms read differently at a glance).
 */
export function AcademicTrackingEmptyState({ variant, labels }: Readonly<AcademicTrackingEmptyStateProps>): ReactNode {
  const icon =
    variant === "filtered" ? <SearchOffOutlined sx={{ fontSize: 32 }} /> : <PersonOffOutlined sx={{ fontSize: 32 }} />;
  const title = variant === "filtered" ? labels.emptyFilteredTitle : labels.emptyTitle;
  const body = variant === "filtered" ? labels.emptyFilteredBody : labels.emptyBody;
  return <IconCircleEmptyState testId={`academic-tracking-empty-${variant}`} icon={icon} title={title} body={body} />;
}

interface AcademicTrackingSectionEmptyStateProps {
  /** `data-testid` hook distinguishing the section (homework / reports). */
  readonly testId: string;
  /** Decorative section icon (caller picks the `*Outlined` glyph). */
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
}

/**
 * One drill-down history section's zero-history state, card-mounted so it
 * reads as a section of the detail surface rather than a whole-page state.
 */
export function AcademicTrackingSectionEmptyState({
  testId,
  icon,
  title,
  body,
}: Readonly<AcademicTrackingSectionEmptyStateProps>): ReactNode {
  return (
    <Card
      sx={theme => ({
        border: `1px solid ${theme.palette.border.light}`,
        borderRadius: "12px",
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <Box sx={{ padding: { xs: 2, md: 3 } }}>
        <IconCircleEmptyState testId={testId} icon={icon} title={title} body={body} />
      </Box>
    </Card>
  );
}
