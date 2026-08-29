"use client";

import {
  CheckCircleOutlined as ActiveIcon,
  CancelOutlined as CancelledIcon,
  HistoryOutlined as ExpiredIcon,
  BlockOutlined as InactiveIcon,
  EventRepeatOutlined as IntervalIcon,
  PaymentsOutlined as PaymentIcon,
  HourglassTopOutlined as PendingIcon,
  CalendarMonthOutlined as PeriodIcon,
  AutorenewOutlined as RenewIcon,
  ScheduleOutlined as RequestedIcon,
  SchoolOutlined as SessionsIcon,
} from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import type { Palette } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { MySubscriptionsQuery_mySubscriptions } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { MySubscriptionsLabels } from "@/shared/locale/types/mySubscriptions";

/**
 * `MySubscriptionCard` — one subscription lifecycle tile on the
 * student-facing `/subscriptions` page (DEV1-010). Presentational ONLY:
 * every fact rendered comes from the canonical `Subscription` row handed
 * in by {@link MySubscriptionsContainer} (the Apollo read + renewal
 * mutation live in the container).
 *
 * Value-rendering contract (mirrors the admin lifecycle card, first-person
 * posture):
 *  - `price` is the server-canonical decimal STRING — rendered verbatim
 *    beside its currency code; NO numeric coercion (REQ-060 discipline);
 *  - the status chip maps the `subscription_status` machine code onto a
 *    SEMANTIC theme family (active → success, pending → warning,
 *    expired → neutral surface, cancelled → error, suspended → secondary)
 *    — token-only, zero hardcoded hex, contrast preserved in light+dark;
 *    each family carries its OWN status icon (the admin card is iconless —
 *    a deliberate student-surface upgrade: status reads at a glance);
 *  - the validity period renders as two labeled lines (started/ends); a
 *    pending row's unstarted lifecycle reads `labelNotStarted`, a null end
 *    date on a non-pending row reads the locale-neutral dash
 *    (`labelOpenEnded` — punctuation, not copy);
 *  - the payment stamps render as an LTR monospace machine artifact
 *    (`offline_cash · RCPT-…`); unstamped rows keep the neutral dash;
 *  - timestamps pass through `formatApplicantDate` (the established
 *    locale-fallback UTC stamp);
 *  - the action row mirrors the server's renewal fence EXACTLY (the
 *    service only fences an UNRESOLVED PENDING request):
 *      · a RENEWABLE row (terminal status + active plan + no pending
 *        request for the plan) renders the Renew CTA and delegates to the
 *        container's dialog boundary — the card never mutates;
 *      · a row whose plan already carries an unresolved pending request
 *        renders the `renewBlockedPending` note chip;
 *      · a row whose plan was DEACTIVATED renders the
 *        `renewUnavailableInactive` note chip;
 *      · pending/active rows render NO action (a pending row is already
 *        in flight; renewal semantics for an active row belong to the
 *        payment-activation phase).
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens, zero
 * hardcoded hex, `*Outlined` icons, RTL-safe logical composition, every
 * user-facing string resolved from the compile-time `MySubscriptionsLabels`
 * tree via property access.
 */

export interface MySubscriptionCardProps {
  /** Canonical lifecycle row (container-owned Apollo payload). */
  readonly subscription: MySubscriptionsQuery_mySubscriptions;
  /** Full mySubscriptions-namespace labels (property access ONLY inside). */
  readonly labels: MySubscriptionsLabels;
  /** App locale tag for the timestamp rendering. */
  readonly locale: string;
  /**
   * Whether this row is renewable: terminal status, the plan is still
   * active, and the plan carries NO unresolved pending request
   * (container-derived — the same predicate the server enforces).
   */
  readonly canRenew: boolean;
  /**
   * Whether the plan already carries an unresolved PENDING request
   * (container-derived) — renders the pending-blocked note instead of a
   * CTA.
   */
  readonly planHasPendingRequest: boolean;
  /** Card intent: open the renewal dialog for this subscription's plan. */
  readonly onRenew: (subscription: MySubscriptionsQuery_mySubscriptions) => void;
}

/** System monospace stack for the payment-stamp machine codes. */
const MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Locale-neutral em dash for unstamped payment rows — punctuation, not copy. */
const UNSTAMPED_PAYMENT_DASH = "—";

/**
 * Maps one `subscription_status` machine code to its LOCALIZED display
 * name (unknown codes — a future enum value — degrade to the raw code
 * rather than crashing).
 */
function statusDisplay(code: string, labels: MySubscriptionsLabels): string {
  switch (code) {
    case "pending":
      return labels.statusPending;
    case "active":
      return labels.statusActive;
    case "expired":
      return labels.statusExpired;
    case "cancelled":
      return labels.statusCancelled;
    case "suspended":
      return labels.statusSuspended;
    default:
      return code;
  }
}

/**
 * Maps one `subscription_status` machine code to its semantic theme
 * family — the (background, foreground) container/on-container token pair.
 * Unknown codes degrade to the neutral surface pair rather than crashing.
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

/**
 * Status icon per machine code — the student surface's at-a-glance status
 * upgrade. Unknown codes render no icon rather than crashing.
 */
function statusIcon(code: string): typeof ActiveIcon | null {
  switch (code) {
    case "active":
      return ActiveIcon;
    case "pending":
      return PendingIcon;
    case "cancelled":
      return CancelledIcon;
    case "expired":
      return ExpiredIcon;
    case "suspended":
      return InactiveIcon;
    default:
      return null;
  }
}

/** True while the row is past the pending stage but not yet terminal-active. */
function isRenewableStatus(status: string): boolean {
  return status === "expired" || status === "cancelled" || status === "suspended";
}

/** Started-line value — the formatted start stamp, or the not-started copy. */
function startedValueOf(
  subscription: MySubscriptionsQuery_mySubscriptions,
  labels: MySubscriptionsLabels,
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
  subscription: MySubscriptionsQuery_mySubscriptions,
  labels: MySubscriptionsLabels,
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
function paymentValueOf(subscription: MySubscriptionsQuery_mySubscriptions): string {
  if (subscription.paymentMethod === null) {
    return UNSTAMPED_PAYMENT_DASH;
  }
  if (subscription.paymentReference === null) {
    return subscription.paymentMethod;
  }
  return `${subscription.paymentMethod} · ${subscription.paymentReference}`;
}

/** Icon+label/value spec row (mirrors the admin lifecycle card's anatomy). */
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

export function MySubscriptionCard({
  subscription,
  labels,
  locale,
  canRenew,
  planHasPendingRequest,
  onRenew,
}: Readonly<MySubscriptionCardProps>): ReactNode {
  const statusText = statusDisplay(subscription.status, labels);
  const StatusIcon = statusIcon(subscription.status);

  // Validity period — two labeled lines; a pending row has not begun, a
  // non-pending row without a fixed end reads the locale-neutral dash.
  const startedLine = `${labels.labelStarted}: ${startedValueOf(subscription, labels, locale)}`;
  const endsLine = `${labels.labelEnds}: ${endsValueOf(subscription, labels, locale)}`;

  // Payment stamps — machine artifact when stamped, dash when not.
  const paymentValue = paymentValueOf(subscription);

  // Action posture — the server's renewal fence mirrored client-side.
  const planIsActive = subscription.plan.isActive;
  const showRenewCta = canRenew;
  const showPendingNote = !showRenewCta && isRenewableStatus(subscription.status) && planHasPendingRequest;
  const showInactiveNote =
    !showRenewCta && isRenewableStatus(subscription.status) && !planIsActive && !planHasPendingRequest;

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
      data-testid={`my-subscription-card-${subscription.id}`}
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
            hear "Status: Active", not a bare adjective; the icon repeats
            the status non-textually. */}
        <Stack
          spacing={1}
          sx={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}
        >
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            {subscription.plan.title}
          </Typography>
          <Chip
            icon={StatusIcon === null ? undefined : <StatusIcon />}
            label={statusText}
            size="small"
            aria-label={`${labels.labelStatus}: ${statusText}`}
            sx={theme => {
              const pair = statusChipPair(subscription.status, theme.palette);
              return {
                fontWeight: 600,
                bgcolor: pair.background,
                color: pair.foreground,
                "& .MuiChip-icon": { color: pair.foreground },
              };
            }}
            data-testid={`my-subscription-status-${subscription.id}`}
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

        {/* Lifecycle specs — pinned above the action row by the 1fr spacer
            row so buttons align across the whole grid row. */}
        <Box sx={{ display: "grid", gap: 1, alignContent: "end" }}>
          <Divider sx={{ mb: 0.5 }} />
          <CardSpecRow
            Icon={SessionsIcon}
            label={labels.labelSessions}
            value={String(subscription.plan.sessionCount)}
          />
          <CardSpecRow
            Icon={IntervalIcon}
            label={labels.labelInterval}
            value={labels.intervalDays(subscription.plan.intervalDays)}
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

        {/* Action row — the server's renewal fence mirrored: a renewable
            row delegates to the container's dialog boundary; a terminal
            row blocked by an in-flight request or a deactivated plan
            renders its note chip; pending/active rows render NO action.
            The aria-label keeps the plan title identifying for screen
            readers. */}
        <Box sx={{ display: "grid", gap: 1 }}>
          {showRenewCta ? (
            <Button
              variant="contained"
              fullWidth
              onClick={() => onRenew(subscription)}
              aria-label={`${labels.renewCta} — ${subscription.plan.title}`}
              startIcon={<RenewIcon />}
              sx={{ borderRadius: 2, py: 1 }}
              data-testid={`my-subscription-renew-${subscription.id}`}
            >
              {labels.renewCta}
            </Button>
          ) : showPendingNote ? (
            <Stack
              spacing={0.5}
              sx={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 0.75, py: 1 }}
              data-testid={`my-subscription-blocked-pending-${subscription.id}`}
            >
              <PendingIcon fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} aria-hidden />
              <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
                {labels.renewBlockedPending}
              </Typography>
            </Stack>
          ) : showInactiveNote ? (
            <Stack
              spacing={0.5}
              sx={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 0.75, py: 1 }}
              data-testid={`my-subscription-blocked-inactive-${subscription.id}`}
            >
              <InactiveIcon fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} aria-hidden />
              <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
                {labels.renewUnavailableInactive}
              </Typography>
            </Stack>
          ) : null}
        </Box>
      </CardContent>
    </Card>
  );
}
