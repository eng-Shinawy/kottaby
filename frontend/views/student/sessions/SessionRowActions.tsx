"use client";

import { Button, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionRowAction } from "@/frontend/views/student/sessions/sessionRowAction";

/**
 * The caller-supplied lifecycle CTAs (teacher Start/Complete, DEV3-012
 * student Confirm) — the mapping stays byte-identical to the original
 * in-row implementation. The tooltip-carrying variant (DEV3-012 confirm)
 * rides the SAME testid/button shape as the plain variant so callers and
 * suites stay uniform.
 */
export function SessionRowActions({
  actions,
  sessionId,
}: Readonly<{ actions: ReadonlyArray<SessionRowAction> | undefined; sessionId: string }>): ReactNode {
  return (
    <>
      {(actions ?? []).map(action =>
        action.tooltip === undefined ? (
          <Button
            key={action.id}
            variant="outlined"
            color={action.color ?? "primary"}
            disabled={action.disabled === true}
            onClick={() => action.onIntent(sessionId)}
            data-testid={`session-action-${sessionId}-${action.id}`}
            sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
          >
            {action.label}
          </Button>
        ) : (
          <Tooltip key={action.id} title={action.tooltip} placement="top">
            <span>
              <Button
                variant="outlined"
                color={action.color ?? "primary"}
                disabled={action.disabled === true}
                onClick={() => action.onIntent(sessionId)}
                data-testid={`session-action-${sessionId}-${action.id}`}
                sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
              >
                {action.label}
              </Button>
            </span>
          </Tooltip>
        )
      )}
    </>
  );
}
