"use client";

import {
  ScheduleOutlined as RequestedIcon,
  BadgeOutlined as RequesterIcon,
  SchoolOutlined as SessionsIcon,
  TaskAltOutlined as VerifyIcon,
} from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { PaymentVerificationLabels } from "@/shared/locale/types/paymentVerification";

/**
 * `VerificationRequestCard` — one pending subscription request tile in the
 * admin verification queue (DEV1-006 Phase B). Presentational ONLY: every
 * fact rendered comes from the `AdminSubscriptionRequest` row handed in by
 * {@link PaymentVerificationContainer} (the Apollo read + mutation live in
 * the container).
 *
 * Value-rendering contract (mirrors the storefront card):
 *  - `price` is the server-canonical decimal STRING — rendered verbatim as
 *    the card's visual anchor beside its currency code; NO numeric
 *    coercion (REQ-060 discipline);
 *  - the purchaser identity renders as DATA rows (name + email) — never
 *    interpolated into translation strings;
 *  - the requested-at timestamp renders through `formatApplicantDate`
 *    (the established locale-fallback UTC stamp — identical contract to
 *    the applicant cooldown line).
 *
 * The card carries a pending chip (`status` echoed from the wire — the
 * read filters on pending, the chip is belt-and-suspenders client hygiene
 * for cache-hygiene regressions) and the verify CTA which delegates to the
 * container's `onVerify` — the card never opens dialogs and never mutates.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens, zero
 * hardcoded hex, `*Outlined` icons, RTL-safe logical composition, every
 * user-facing string resolved from the compile-time
 * `PaymentVerificationLabels` tree via property access.
 */

export interface VerificationRequestCardProps {
  /** Canonical admin-queue row (container-owned Apollo payload). */
  readonly request: AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests;
  /** Full paymentVerification-namespace labels (property access ONLY). */
  readonly labels: PaymentVerificationLabels;
  /** App locale tag for the requested-at timestamp rendering. */
  readonly locale: string;
  /** Card intent: open the verify-payment dialog for this request. */
  readonly onVerify: (request: AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests) => void;
}

/** Icon+label/value spec row (mirrors the storefront card's row anatomy). */
function CardSpecRow({
  Icon,
  label,
  value,
  secondary,
}: Readonly<{ Icon: typeof SessionsIcon; label: string; value: string; secondary?: string }>): ReactNode {
  return (
    <Stack spacing={0} sx={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
      <Icon fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} aria-hidden />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, minWidth: 72 })}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, textAlign: "end", minWidth: 0 }}>
        <Typography variant="body1" sx={theme => ({ fontWeight: 600, color: theme.palette.text.primary })}>
          {value}
        </Typography>
        {secondary ? (
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
            {secondary}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

export function VerificationRequestCard({
  request,
  labels,
  locale,
  onVerify,
}: Readonly<VerificationRequestCardProps>): ReactNode {
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
        display: "flex",
        flexDirection: "column",
        transition: theme.transitions.create(["border-color", "transform", "box-shadow"], {
          duration: theme.transitions.duration.short,
        }),
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: theme.palette.shadow.card,
          borderColor: theme.palette.primary.main,
        },
      })}
      data-testid={`admin-verification-card-${request.id}`}
    >
      <CardContent
        sx={{
          display: "grid",
          gap: 2,
          p: { xs: 2.5, sm: 3 },
          flexGrow: 1,
          gridTemplateRows: "auto auto 1fr auto",
        }}
      >
        {/* Title row — the requested plan's title + the pending chip. */}
        <Stack
          spacing={1}
          sx={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}
        >
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            {request.plan.title}
          </Typography>
          <Chip
            label={request.status}
            size="small"
            sx={theme => ({
              bgcolor: theme.palette.tertiaryContainer,
              color: theme.palette.onTertiaryContainer,
            })}
            data-testid={`admin-verification-status-${request.id}`}
          />
        </Stack>

        {/* Price — decimal string verbatim + currency code; the queue card's
            visual anchor. */}
        <Stack spacing={0.5} sx={{ flexDirection: "row", alignItems: "baseline", gap: 1 }}>
          <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>
            {request.plan.price}
          </Typography>
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
            {request.plan.currency}
          </Typography>
        </Stack>

        {/* Purchaser + specs — pinned above the CTA by the 1fr spacer row so
            buttons align across the whole grid row. */}
        <Box sx={{ display: "grid", gap: 1, alignContent: "end" }}>
          <Divider sx={{ mb: 0.5 }} />
          <CardSpecRow
            Icon={RequesterIcon}
            label={labels.labelRequestedBy}
            value={request.user.fullName}
            secondary={request.user.email}
          />
          <CardSpecRow Icon={SessionsIcon} label={labels.labelSessions} value={String(request.plan.sessionCount)} />
          <CardSpecRow
            Icon={RequestedIcon}
            label={labels.labelRequestedAt}
            value={formatApplicantDate(request.createdAt, locale)}
          />
        </Box>

        {/* CTA — delegates to the container (verify dialog). The aria-label
            keeps the requester's name identifying for screen readers (the
            visible label alone is not). */}
        <Button
          variant="contained"
          fullWidth
          onClick={() => onVerify(request)}
          aria-label={`${labels.verifyCta} — ${request.user.fullName}`}
          startIcon={<VerifyIcon />}
          sx={{ borderRadius: 2, py: 1 }}
          data-testid={`admin-verification-verify-${request.id}`}
        >
          {labels.verifyCta}
        </Button>
      </CardContent>
    </Card>
  );
}
