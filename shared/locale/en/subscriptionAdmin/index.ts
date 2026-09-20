import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

/** The plain plan-change success line — the suppressed zero-count form. */
const PLAN_CHANGE_PLAIN = "Plan changed.";

export const subscriptionAdminEn: SubscriptionAdminLabels = {
  title: "Subscriptions",
  emptyState: {
    title: "No subscriptions",
    message: "This student has no subscription records yet.",
  },
  fields: {
    plan: "Plan",
    status: "Status",
    start: "Start",
    end: "End",
    lastAction: "Last audit action",
  },
  planFacts: {
    sessions: sessions => (sessions === 1 ? "1 session" : `${sessions} sessions`),
    cycle: days => (days === 1 ? "1-day cycle" : `${days}-day cycle`),
  },
  status: {
    active: "Active",
    expired: "Expired",
    pending: "Pending",
    cancelled: "Cancelled",
    suspended: "Suspended",
  },
  actions: {
    extend: "Extend",
    renew: "Renew",
    cancel: "Cancel",
    changePlan: "Change plan",
  },
  filter: {
    all: "All",
    empty: "No subscriptions with this status.",
  },
  summary: {
    nextExpiry: "Next expiry",
    nextExpiryNone: "No active window",
  },
  expiryBadge: {
    upcoming: days => {
      if (days === 0) return "Ends today";
      return days === 1 ? "Ends in 1 day" : `Ends in ${days} days`;
    },
    past: days => (days === 1 ? "Expired 1 day ago" : `Expired ${days} days ago`),
  },
  copyId: {
    copy: "Copy subscription ID",
    copied: "Copied",
  },
  auditLink: "View in audit trail",
  auditLinkCount: count => (count === 1 ? "1 entry" : `${count} entries`),
  digest: {
    copy: "Copy subscriptions summary",
    copied: "Summary copied",
  },
  extend: {
    title: "Extend subscription",
    daysLabel: "Days to add",
    daysHelper: "Added to the period's current end date.",
    daysInvalid: "Enter a whole number of days greater than zero.",
  },
  renew: {
    title: "Renew subscription",
    message:
      "Renewing opens a fresh active period on this subscription's plan and credits the student's session balance for the plan's full session count.",
  },
  cancel: {
    title: "Cancel subscription",
    message: "Cancelling ends this subscription while leaving the student's session balances untouched.",
    reasonLabel: "Reason (optional)",
    reasonCounter: (count, max) => `${count}/${max} — Up to ${max} characters, recorded in the audit trail.`,
  },
  changePlan: {
    title: "Change plan",
    message:
      "The current subscription is cancelled and a fresh period opens on the selected plan. Only active plans crediting the same balance lane are eligible.",
    planLabel: "New plan",
    noPlans: "No other active plan credits the same balance lane.",
    errorState: {
      title: "Could not load plans",
      message: "Something went wrong while loading the plan catalog. Retry to load the plans again.",
    },
  },
  success: {
    extend: days => (days === 1 ? "Subscription extended by 1 day." : `Subscription extended by ${days} days.`),
    renew: "Subscription renewed — a fresh period is now active.",
    cancel: "Subscription cancelled. Session balances were left unchanged.",
    planChange: PLAN_CHANGE_PLAIN,
    planChangeCarried: carry => {
      if (carry === 0) return PLAN_CHANGE_PLAIN;
      return carry === 1 ? "Plan changed — 1 session carried over." : `Plan changed — ${carry} sessions carried over.`;
    },
    planChangeForfeited: forfeit => {
      if (forfeit === 0) return PLAN_CHANGE_PLAIN;
      return forfeit === 1
        ? "Plan changed — 1 remaining session forfeited."
        : `Plan changed — ${forfeit} remaining sessions forfeited.`;
    },
  },
  errorState: {
    title: "Could not load subscriptions",
    message: "Something went wrong while loading this student's subscriptions.",
    retry: "Retry",
  },
  genericError: "Something went wrong. Please try again.",
};
