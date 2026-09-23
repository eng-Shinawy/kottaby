"use client";

/**
 * AdminTeachersTabStrip — the /teachers surface's tab card: the MUI `Tabs`
 * strip (sx-only, RTL-safe — the indicator and label order mirror
 * automatically under the RTL emotion cache) with the applicants tab's
 * count badge. Tab state is surface-owned; this strip only reports
 * selections.
 */

import { Box, Card, Stack, Tab, Tabs } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

/** The two tabs of the /teachers surface (values double as MUI `Tab` values). */
export type TeachersTab = "teachers" | "applicants";

interface ApplicantsTabLabelProps {
  readonly label: string;
  /** The queue total when the badge is showing; `null` hides the badge. */
  readonly badge: number | null;
}

/**
 * The applicants tab label with the small count chip — a tonal pill on the
 * theme's secondary container lane (the Teacher identity lane) so it reads
 * as metadata, not as a destructive alert.
 */
function ApplicantsTabLabel({ label, badge }: ApplicantsTabLabelProps): ReactNode {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Box component="span">{label}</Box>
      {badge !== null && (
        <Box
          component="span"
          sx={theme => ({
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 20,
            height: 20,
            paddingInline: 0.75,
            borderRadius: "999px",
            bgcolor: theme.palette.secondaryContainer,
            color: theme.palette.onSecondaryContainer,
            fontSize: 12,
            fontWeight: 700,
          })}
        >
          {badge}
        </Box>
      )}
    </Stack>
  );
}

interface AdminTeachersTabStripProps {
  readonly labels: Pick<AdminTeachersLabels, "title" | "tabs">;
  readonly activeTab: TeachersTab;
  /** The queue total when the inactive-tab badge is showing; `null` hides it. */
  readonly applicantsBadge: number | null;
  /** Flips the surface's active tab (surface-owned state). */
  readonly onChangeTab: (tab: TeachersTab) => void;
}

export function AdminTeachersTabStrip({
  labels,
  activeTab,
  applicantsBadge,
  onChangeTab,
}: AdminTeachersTabStripProps): ReactNode {
  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <Tabs
        value={activeTab}
        onChange={(_, value: TeachersTab) => {
          onChangeTab(value);
        }}
        aria-label={labels.title}
        sx={theme => ({ paddingInline: 2, borderBottom: `1px solid ${theme.palette.border.light}` })}
      >
        <Tab
          value="teachers"
          label={labels.tabs.teachersTab}
          id="teachers-tab-teachers"
          aria-controls="teachers-panel-teachers"
          sx={{ minHeight: 48, textTransform: "none", fontWeight: 600, fontSize: 15 }}
        />
        <Tab
          value="applicants"
          label={<ApplicantsTabLabel label={labels.tabs.applicantsTab} badge={applicantsBadge} />}
          id="teachers-tab-applicants"
          aria-controls="teachers-panel-applicants"
          sx={{ minHeight: 48, textTransform: "none", fontWeight: 600, fontSize: 15 }}
        />
      </Tabs>
    </Card>
  );
}
