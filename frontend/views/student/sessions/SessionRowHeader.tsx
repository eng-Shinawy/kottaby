"use client";

import { ReportProblemOutlined as DisputedIcon } from "@mui/icons-material";
import { Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { SessionRowCounterpart } from "@/frontend/views/student/sessions/SessionRowCounterpart";
import { STATUS_ICON, STATUS_TONE, TONE_COLORS } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { Sessions, useAppTranslation } from "@/shared/locale";

interface SessionRowHeaderProps {
  /** The session lifecycle status — drives the chip's icon + tone pair. */
  readonly status: SessionStatus;
  /** Resolved chip label (i18n key or the raw status fallback). */
  readonly statusLabel: string;
  /**
   * Localized intent title — the resolved `SessionsLabels` intent member
   * (the row resolves `INTENT_LABEL_KEY[session.intent]` with the honest
   * fallbacks: `NO_VALUE_PLACEHOLDER` when the payload intent is null, the
   * raw payload value when the member is unknown to the table).
   */
  readonly intentText: string;
  /**
   * The counterpart identity band payload (name + caption) — the
   * batch-enriched `Session.student`/`Session.teacher` role-scoped pair
   * the row resolved. An absent/null name renders NO band — the
   * enrichment is the participant lists' counterpart side only, so the
   * honest null is the no-band answer.
   */
  readonly counterpart: {
    readonly name: string | null;
    readonly caption: string;
  };
}

/**
 * The row's header band: booking-intent title + counterpart identity band
 * + lifecycle status chip. Extracted from `SessionRow` so the row
 * component stays an orchestrator; the tone/icon lookups resolve through
 * the shared Record tables (defensive-corrupt arms keep unknown statuses
 * renderable, never crashing). The intent title is the LOCALIZED label
 * (never the raw enum member); the counterpart band sits directly under
 * the title inside the title column — left-aligned to it (RTL-aware) and
 * never wrapping under the status chip on sm+ (the outer Stack owns the
 * column/row split; on xs everything flows naturally).
 */
export function SessionRowHeader({
  status,
  statusLabel,
  intentText,
  counterpart,
}: Readonly<SessionRowHeaderProps>): ReactNode {
  const t = useAppTranslation(Sessions);

  const statusTone = STATUS_TONE[status] ?? "warning";
  const toneColors = TONE_COLORS[statusTone] ?? TONE_COLORS.warning;
  const Icon = STATUS_ICON[status] ?? DisputedIcon;

  return (
    <Stack
      sx={{
        gap: 1.5,
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "flex-start", sm: "center" },
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <Stack sx={{ gap: 0.5, minWidth: 0 }}>
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.intent}
        </Typography>
        <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
          {intentText}
        </Typography>
        <SessionRowCounterpart name={counterpart.name} caption={counterpart.caption} />
      </Stack>
      <Chip
        icon={<Icon fontSize="small" />}
        label={statusLabel}
        size="small"
        sx={theme => ({
          fontWeight: 600,
          bgcolor: toneColors.bg(theme.palette),
          color: toneColors.fg(theme.palette),
          "& .MuiChip-icon": {
            color: toneColors.fg(theme.palette),
          },
        })}
      />
    </Stack>
  );
}
