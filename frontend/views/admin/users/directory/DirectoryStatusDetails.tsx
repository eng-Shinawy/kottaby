"use client";

/**
 * DirectoryStatusDetails — the per-role status/details headline the
 * directory renders instead of a generic status chip, shared by the desktop
 * table and the mobile card list.
 *
 * Teacher-applicant rows may carry MULTIPLE lifecycle signals at once (a
 * pending review AND an active cooldown, a certified teacher with no
 * cooldown, a failed applicant with an expired cooldown…). The cell renders
 * them as a compact vertical chip stack (flex-start aligned so the pills
 * never stretch across the fixed-layout column) and falls back to the
 * em-dash only when NO signal applies.
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ApplicantStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { DirectoryUserItem } from "@/frontend/views/admin/users/directory";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import { asDirectoryRole, directoryCooldownChipOf } from "@/frontend/views/admin/users/utils";
import { useAppLocale } from "@/shared/locale/localeContext";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** THE em-dash fallback for an unset cell value. Kept as a constant so the
 * details cell and the relative-time cell share one glyph source. */
const EM_DASH = "—";

/** ICU token of the plural-band `childrenCount` templates. */
const CHILDREN_COUNT_TOKEN = "{count}";

/**
 * Expands the plural-band linked-children chip: `Intl.PluralRules` of the
 * active locale resolves the band (ar carries the full
 * zero/one/two/few/many/other set; en resolves one/other) and the band's
 * `{count}` template renders the verbatim count. Replaces the former
 * function leaf that broke the locale parity suites and crossed the RSC
 * boundary as an unserializable prop.
 */
function childrenCountLabel(
  bands: AdminUsersLabels["directoryChips"]["childrenCount"],
  count: number,
  locale: string
): string {
  const category = new Intl.PluralRules(locale === "en" ? "en" : "ar").select(count);
  return bands[category].replace(CHILDREN_COUNT_TOKEN, String(count));
}

interface DirectoryStatusDetailsProps {
  readonly user: DirectoryUserItem;
  readonly labels: Pick<AdminUsersLabels, "directoryChips">;
}

/**
 * Status/details cell — the per-role headline the prototype renders instead
 * of a generic status chip:
 *  - admin/system rows: italic `text.secondary` "System User" line;
 *  - teachers: a CHIP STACK — `pendingReview` (warning lane) while the
 *    application is pending / in evaluation, `certified` (secondary lane)
 *    when the teacher is approved, PLUS the applicant cooldown chip
 *    (warning when active, neutral when expired — the read-time state comes
 *    off the same shared derivation the detail page uses); em-dash only
 *    when no signal applies;
 *  - students: `parentLinked` (success lane) when the student is linked;
 *  - parents: `childrenCount(count)` (neutral lane) when linked;
 *  - anything else: the em-dash fallback.
 */
export function DirectoryStatusDetails({ user, labels }: DirectoryStatusDetailsProps): ReactNode {
  const locale = useAppLocale();
  const role = asDirectoryRole(user.role);
  // Every role composes into ONE chips stack so the function keeps a single
  // return shape (sonarjs/function-return-type) — and the column renders one
  // component vocabulary: admin rows carry the neutral System User chip
  // (the old bare italic line broke the pill rhythm — pass-2 inspector
  // MEDIUM on 1440, LOW on 834).
  const chips: ReactNode[] = [];
  if (role === "Admin") {
    chips.push(<TonalChip key="system" tone="neutral" label={labels.directoryChips.systemUser} />);
  } else if (role === "Teacher") {
    if (user.applicantStatus === ApplicantStatus.Pending || user.applicantStatus === ApplicantStatus.InEvaluation) {
      chips.push(<TonalChip key="pending" tone="warning" label={labels.directoryChips.pendingReview} />);
    } else if (user.teacherIsApproved) {
      chips.push(<TonalChip key="certified" tone="secondary" label={labels.directoryChips.certified} />);
    }
    const cooldown = directoryCooldownChipOf(user, labels.directoryChips, locale);
    if (cooldown) {
      chips.push(
        <TonalChip
          key="cooldown"
          tone={cooldown.tone}
          label={cooldown.label}
          title={cooldown.tooltip ?? undefined}
          // State-dot language: the ACTIVE cooldown breathes (a live
          // restriction reads as alive at a glance); the expired one keeps
          // the same dot, static — one visual pair, two liveness states.
          dot
          pulse={cooldown.tone === "warning"}
        />
      );
    }
  } else if (role === "Student") {
    if (user.studentHasParentLink) {
      chips.push(<TonalChip key="linked" tone="success" label={labels.directoryChips.parentLinked} />);
    }
  } else if ((user.parentLinkedChildrenCount ?? 0) > 0) {
    chips.push(
      <TonalChip
        key="children"
        tone="neutral"
        label={childrenCountLabel(labels.directoryChips.childrenCount, user.parentLinkedChildrenCount ?? 0, locale)}
      />
    );
  }
  let content: ReactNode;
  if (chips.length === 0) {
    content = <EmDash />;
  } else if (chips.length === 1) {
    content = chips[0];
  } else {
    content = <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.75 }}>{chips}</Box>;
  }
  return content;
}

/** Muted em-dash rendered in `text.secondary` for empty cell values. */
function EmDash(): ReactNode {
  return (
    <Typography variant="body2" component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
      {EM_DASH}
    </Typography>
  );
}
