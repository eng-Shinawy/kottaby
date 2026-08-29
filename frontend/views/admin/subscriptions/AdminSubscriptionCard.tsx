"use client";

import {
  CancelOutlined as CancelIcon,
  PaymentsOutlined as PaymentIcon,
  CalendarMonthOutlined as PeriodIcon,
  ScheduleOutlined as RequestedIcon,
  SchoolOutlined as SessionsIcon,
  BadgeOutlined as SubscriberIcon,
} from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import type { Palette } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminSubscriptionsQuery_adminSubscriptions_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

/**
 * `AdminSubscriptionCard` — one subscription lifecycle tile in the admin
 * subscriptions manager (DEV1-009). Presentational ONLY: every fact
 * rendered comes from the `AdminSubscription` row handed in by
 * {@link frontend/views/admin/subscriptions/AdminSubscriptionsContainer}
 * (the Apollo read + mutation live in the container).
 *
 * Value-rendering contract (mirrors the verification-queue card):
 *  - `price` is the server-canonical decimal STRING — rendered verbatim
 *    beside its currency code; NO numeric coercion (REQ-060 discipline);
 *  - the subscriber identity renders as DATA rows (name + email) — never
 *    interpolated into translation strings;
 *  - the validity period renders as two labeled lines (started/ends); a
 *    pending row's unstarted lifecycle reads the dedicated `labelNotStarted`
 *    copy, a null end date on a non-pending row reads the locale-neutral
 *    dash (`labelOpenEnded` — punctuation, not copy);
 *  - the payment stamps render as an LTR monospace machine artifact
 *    (`offline_cash · RCPT-…` — the audit-trail machine-code posture);
 *    unstamped rows keep the locale-neutral dash;
 *  - timestamps pass through `formatApplicantDate` (the established
 *    locale-fallback UTC stamp);
 *  - the status chip maps the `subscription_status` machine code onto a
 *    SEMANTIC theme family (active → success, pending → warning,
 *    expired → neutral surface, cancelled → error, suspended → secondary)
 *    — token-only, zero hardcoded hex, contrast preserved in light+dark
 *    (the audit trail's chip-family taxonomy);
 *  - the cancel CTA renders ONLY on cancellable rows (`active`/`pending`);
 *    terminal rows (`expired`/`cancelled`/`suspended`) render NO CTA at
 *    all — the server fences the transition, the card mirrors it.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens, zero
 * hardcoded hex, `*Outlined` icons, RTL-safe logical composition, every
 * user-facing string resolved from the compile-time
 * `SubscriptionManagementLabels` tree via property access.
 */

export interface AdminSubscriptionCardProps {
  /** Canonical lifecycle row (container-owned Apollo payload). */
  readonly subscription: AdminSubscriptionsQuery_adminSubscriptions_items;
  /** Full subscriptionManagement-namespace labels (property access ONLY). */
  readonly labels: SubscriptionManagementLabels;
  /** App locale tag for the timestamp rendering. */
  readonly locale: string;
  /** Card intent: open the cancel dialog for this subscription. */
  readonly onCancel: (subscription: AdminSubscriptionsQuery_adminSubscriptions_items) => void;
}

/**
 * System monospace stack for the payment-stamp machine codes (no theme mono
 * token exists — mirrors the audit trail's details column).
 */
const MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Locale-neutral em dash for unstamped payment rows — punctuation, not copy
 * (the audit trail's null-details contract).
 */
const UNSTAMPED_PAYMENT_DASH = "—";

/**
 * Maps one `subscription_status` machine code to its LOCALIZED display name
 * (unknown codes — a future enum value — degrade to the raw code rather
 * than crashing).
 */
function statusDisplay(code: string, labels: SubscriptionManagementLabels): string {
  switch (code) {
    case "active":
      return labels.filterActive;
    case "pending":
      return labels.filterPending;
    case "expired":
      return labels.filterExpired;
    case "cancelled":
      return labels.filterCancelled;
    case "suspended":
      return labels.filterSuspended;
    default:
      return code;
  }
}

/**
 * Maps one `subscription_status` machine code to its SEMANTIC theme family —
 * the (background, foreground) container/on-container token pair. Unknown
 * codes degrade to the neutral surface pair rather than crashing.
 */
function statusChipPair(code: string, palette: Palette): { readonly background: string; readonly foreground: string } {
  switch (code) {
    case "active":
      return { background: palette.successContainer, foreground: palette.onSuccessContainer };
    case "pending":
      return { background: palette.warningContainer, foreground: palette.onWarningContainer };
    case "cancelled":
      return { background: palette.errorContainer, foreground: palette.onErrorContainer };
    case "suspended":
      return { background: palette.secondaryContainer, foreground: palette.onSecondaryContainer };
    // expired + unknown → the neutral "default" chip (surface tokens).
    default:
      return { background: palette.surfaceContainerHighest, foreground: palette.onSurfaceVariant };
  }
}

/** True while the row can still be cancelled (the server fences the rest). */
function isCancellable(status: string): boolean {
  return status === "active" || status === "pending";
}

/** Started-line value — the formatted start stamp, or the not-started copy. */
function startedValueOf(
  subscription: AdminSubscriptionsQuery_adminSubscriptions_items,
  labels: SubscriptionManagementLabels,
  locale: string
): string {
  if (subscription.startDate === null) {
    return labels.labelNotStarted;
  }
  return formatApplicantDate(subscription.startDate, locale);
}

/**
 * Ends-line value — the formatted end stamp; a pending row has not begun,
 * and a non-pending row without a fixed end reads the locale-neutral dash.
 */
function endsValueOf(
  subscription: AdminSubscriptionsQuery_adminSubscriptions_items,
  labels: SubscriptionManagementLabels,
  locale: string
): string {
  if (subscription.endDate !== null) {
    return formatApplicantDate(subscription.endDate, locale);
  }
  if (subscription.status === "pending") {
    return labels.labelNotStarted;
  }
  return labels.labelOpenEnded;
}

/** Payment-stamp value — the machine artifact, or the neutral dash. */
function paymentValueOf(subscription: AdminSubscriptionsQuery_adminSubscriptions_items): string {
  if (subscription.paymentMethod === null) {
    return UNSTAMPED_PAYMENT_DASH;
  }
  if (subscription.paymentReference === null) {
    return subscription.paymentMethod;
  }
  return `${subscription.paymentMethod} · ${subscription.paymentReference}`;
}

/** Icon+label/value spec row (mirrors the verification card's row anatomy). */
function CardSpecRow({
  Icon,
  label,
  value,
  secondary,
  mono = false,
}: Readonly<{
  Icon: typeof SessionsIcon;
  label: string;
  value: string;
  secondary?: string;
  mono?: boolean;
}>): ReactNode {
  return (
    <Stack spacing={0} sx={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
      <Icon fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} aria-hidden />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, minWidth: 72 })}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, textAlign: "end", minWidth: 0 }}>
        {mono ? (
          <Typography
            variant="body2"
            component="code"
            dir="ltr"
            sx={theme => ({
              fontWeight: 600,
              textAlign: "end",
              fontFamily: MONO_FONT_STACK,
              bgcolor: theme.palette.surfaceContainerHighest,
              borderRadius: 1,
              px: 0.75,
              py: 0.25,
              display: "inline-block",
              overflowWrap: "anywhere",
            })}
          >
            {value}
          </Typography>
        ) : (
          <Typography variant="body1" sx={theme => ({ fontWeight: 600, color: theme.palette.text.primary })}>
            {value}
          </Typography>
        )}
        {secondary ? (
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
            {secondary}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

export function AdminSubscriptionCard({
  subscription,
  labels,
  locale,
  onCancel,
}: Readonly<AdminSubscriptionCardProps>): ReactNode {
  const statusText = statusDisplay(subscription.status, labels);

  // Validity period — two labeled lines; a pending row has not begun, a
  // non-pending row without a fixed end reads the locale-neutral dash.
  const startedLine = `${labels.labelStarted}: ${startedValueOf(subscription, labels, locale)}`;
  const endsLine = `${labels.labelEnds}: ${endsValueOf(subscription, labels, locale)}`;

  // Payment stamps — machine artifact when stamped, dash when not.
  const paymentValue = paymentValueOf(subscription);

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
      data-testid={`admin-subscription-card-${subscription.id}`}
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
        {/* Title row — the subscribed plan's title + the status chip. The
            chip's accessible name prefixes the row label so screen readers
            hear "Status: Active", not a bare adjective. */}
        <Stack
          spacing={1}
          sx={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}
        >
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            {subscription.plan.title}
          </Typography>
          <Chip
            label={statusText}
            size="small"
            aria-label={`${labels.labelStatus}: ${statusText}`}
            sx={theme => {
              const pair = statusChipPair(subscription.status, theme.palette);
              return { fontWeight: 600, bgcolor: pair.background, color: pair.foreground };
            }}
            data-testid={`admin-subscription-status-${subscription.id}`}
          />
        </Stack>

        {/* Price — decimal string verbatim + currency code, under the
            price label caption; the lifecycle card's visual anchor. */}
        <Box sx={{ display: "grid", gap: 0.5 }}>
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
            {labels.labelPrice}
          </Typography>
          <Stack spacing={0.5} sx={{ flexDirection: "row", alignItems: "baseline", gap: 1 }}>
            <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>
              {subscription.plan.price}
            </Typography>
            <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
              {subscription.plan.currency}
            </Typography>
          </Stack>
        </Box>

        {/* Subscriber + lifecycle specs — pinned above the CTA by the 1fr
            spacer row so buttons align across the whole grid row. */}
        <Box sx={{ display: "grid", gap: 1, alignContent: "end" }}>
          <Divider sx={{ mb: 0.5 }} />
          <CardSpecRow
            Icon={SubscriberIcon}
            label={labels.labelSubscriber}
            value={subscription.user.fullName}
            secondary={subscription.user.email}
          />
          <CardSpecRow
            Icon={SessionsIcon}
            label={labels.labelSessions}
            value={String(subscription.plan.sessionCount)}
          />
          <CardSpecRow Icon={PeriodIcon} label={labels.labelPeriod} value={startedLine} secondary={endsLine} />
          <CardSpecRow
            Icon={PaymentIcon}
            label={labels.labelPayment}
            value={paymentValue}
            mono={subscription.paymentMethod !== null}
          />
          <CardSpecRow
            Icon={RequestedIcon}
            label={labels.labelRequestedAt}
            value={formatApplicantDate(subscription.createdAt, locale)}
          />
        </Box>

        {/* CTA — delegates to the container (cancel dialog). Terminal rows
            (expired/cancelled/suspended) render NO CTA: the server fences
            the transition and the card mirrors that posture. The aria-label
            keeps the subscriber's name identifying for screen readers. */}
        {isCancellable(subscription.status) ? (
          <Button
            variant="contained"
            color="error"
            fullWidth
            onClick={() => onCancel(subscription)}
            aria-label={`${labels.cancelCta} — ${subscription.user.fullName}`}
            startIcon={<CancelIcon />}
            sx={{ borderRadius: 2, py: 1 }}
            data-testid={`admin-subscription-cancel-${subscription.id}`}
          >
            {labels.cancelCta}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
