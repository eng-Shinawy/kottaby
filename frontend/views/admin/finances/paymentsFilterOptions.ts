"use client";

/**
 * paymentsFilterOptions — the canonical payment-filter draft options of
 * the payments audit filter bar (`/admin/finances`, payments tab), in
 * display order: the enum-typed status / gateway option lists the Select
 * controls render. Enum members are VALUE imports in runtime expressions.
 */

import {
  type PaymentGateway,
  PaymentGateway as PaymentGatewayEnum,
  type PaymentStatus,
  PaymentStatus as PaymentStatusEnum,
} from "@/frontend/graphql/generated/gql/graphql";

/** The canonical payment-status draft options, in display order. */
export const STATUS_OPTIONS: readonly PaymentStatus[] = [
  PaymentStatusEnum.Pending,
  PaymentStatusEnum.Paid,
  PaymentStatusEnum.Failed,
  PaymentStatusEnum.Refunded,
];

/** The canonical payment-gateway draft options, in display order. */
export const GATEWAY_OPTIONS: readonly PaymentGateway[] = [
  PaymentGatewayEnum.Stripe,
  PaymentGatewayEnum.Paypal,
  PaymentGatewayEnum.Paymob,
  PaymentGatewayEnum.Fawry,
  PaymentGatewayEnum.OfflineCash,
  PaymentGatewayEnum.BankTransfer,
  PaymentGatewayEnum.Scholarship,
  PaymentGatewayEnum.Other,
];
