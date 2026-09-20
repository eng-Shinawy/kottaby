"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminDisputeCaseQuery_adminDisputeCase_auditTrail } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import type { AppLocale } from "@/shared/locale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputeCaseAuditTrail — the session-scoped audit-trail section of
 * the case-review dialog: every entry renders its action type, actor,
 * moment (through the shared locale-aware date formatter) and serialized
 * details VERBATIM — plain text nodes only, no markup injection. An empty
 * trail is an honest localized empty state, never fabricated rows.
 *
 * MUI v9 discipline: `sx`-only styling, colors through `theme.palette.*`.
 */

interface AdminDisputeCaseAuditTrailProps {
  /** The case query's audit-trail entries (non-null array — possibly empty). */
  readonly entries: ReadonlyArray<AdminDisputeCaseQuery_adminDisputeCase_auditTrail>;
  /** Localized sessions-namespace labels (the case-review vocabulary). */
  readonly t: SessionsLabels;
  /** Active app locale — drives the entry-moment formatter. */
  readonly locale: AppLocale;
}

/** The audit-trail section of the case-review dialog. */
export function AdminDisputeCaseAuditTrail({
  entries,
  t,
  locale,
}: Readonly<AdminDisputeCaseAuditTrailProps>): ReactNode {
  return (
    <Stack data-testid="admin-dispute-case-audit" sx={{ gap: 1 }}>
      <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 700 }}>
        {t.caseReviewAuditTitle}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.caseReviewEmptyAudit}
        </Typography>
      ) : (
        <Stack sx={{ gap: 1.5 }}>
          {entries.map(entry => (
            <Stack
              key={entry.id}
              sx={theme => ({
                gap: 0.25,
                p: 1.5,
                borderRadius: 2,
                border: "1px solid",
                borderColor: theme.palette.outlineVariant,
              })}
            >
              <Stack
                sx={{
                  gap: 1,
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {entry.actionType}
                </Typography>
                <Typography
                  variant="caption"
                  dir="ltr"
                  title={formatApplicantDate(entry.createdAt, locale)}
                  sx={theme => ({
                    color: theme.palette.text.secondary,
                    // ASCII stamp in an isolated LTR box — the ICU `ar`
                    // stamp's RLM controls scramble the punctuation against
                    // the RTL base direction (round-1 wallet QA finding).
                    unicodeBidi: "isolate",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  })}
                >
                  {formatLedgerStamp(entry.createdAt)}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
                {entry.actorName}
              </Typography>
              {entry.details === null ? null : (
                <Typography
                  variant="caption"
                  sx={theme => ({ color: theme.palette.text.secondary, wordBreak: "break-word" })}
                >
                  {entry.details}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
