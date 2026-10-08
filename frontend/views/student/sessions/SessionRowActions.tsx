"use client";

import { StarOutlined } from "@mui/icons-material";
import { Button, Chip, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionRowAction } from "@/frontend/views/student/sessions/sessionRowAction";
import { TONE_COLORS } from "@/frontend/views/student/sessions/sessionRowPresentation";

/**
 * The caller-supplied lifecycle affordances (teacher Start/Complete, student
 * Confirm, student Rate — plus the read-only rated chip that replaces the
 * Rate CTA once the session is rated). Interactive descriptors render as
 * buttons (the tooltip-carrying variant rides the SAME testid/button shape
 * so callers and suites stay uniform); `readOnly` descriptors render as
 * non-interactive chips carrying the success container tone pair.
 */
export function SessionRowActions({
  actions,
  sessionId,
}: Readonly<{ actions: ReadonlyArray<SessionRowAction> | undefined; sessionId: string }>): ReactNode {
  return (
    <>
      {(actions ?? []).map(action => {
        if (action.readOnly === true) {
          const tone = TONE_COLORS.success;
          return (
            <Chip
              key={action.id}
              icon={<StarOutlined fontSize="small" />}
              label={action.label}
              size="small"
              data-testid={`session-action-${sessionId}-${action.id}`}
              sx={theme => ({
                fontWeight: 600,
                bgcolor: tone.bg(theme.palette),
                color: tone.fg(theme.palette),
                "& .MuiChip-icon": {
                  color: tone.fg(theme.palette),
                },
              })}
            />
          );
        }
        const cta = (
          <Button
            key={action.id}
            variant="outlined"
            color={action.color ?? "primary"}
            disabled={action.disabled === true}
            onClick={() => action.onIntent?.(sessionId)}
            data-testid={`session-action-${sessionId}-${action.id}`}
            sx={theme => ({
              minHeight: { xs: 44, sm: 40 },
              px: 3,
              // Dark-scheme outlined CTAs ride the brighter primary.light
              // rung: the midnight-blue main measures ~3.3:1 on the navy
              // card surface — below the 4.5:1 AA bar for normal-size
              // labels — while the ladder's light rung clears AA without
              // touching contained buttons (white-on-main stays 5.4:1).
              // Light mode keeps the main token (navy on cream is ~9:1).
              // Only the primary arm overrides — the bright success/warning
              // tones already clear AA on the dark card.
              ...((action.color ?? "primary") === "primary"
                ? theme.applyStyles("dark", {
                    color: "var(--mui-palette-primary-light)",
                    borderColor: "color-mix(in srgb, var(--mui-palette-primary-light) 50%, transparent)",
                    // A whisper of fill keeps the outlined CTA from reading
                    // as pale/flat against the navy card (perceived
                    // affordance) without competing with contained buttons.
                    bgcolor: "color-mix(in srgb, var(--mui-palette-primary-light) 8%, transparent)",
                    "&:hover": {
                      borderColor: "var(--mui-palette-primary-light)",
                      bgcolor: "color-mix(in srgb, var(--mui-palette-primary-light) 16%, transparent)",
                    },
                  })
                : {}),
            })}
          >
            {action.label}
          </Button>
        );
        return action.tooltip === undefined ? (
          cta
        ) : (
          <Tooltip key={action.id} title={action.tooltip} placement="top">
            <span>{cta}</span>
          </Tooltip>
        );
      })}
    </>
  );
}
