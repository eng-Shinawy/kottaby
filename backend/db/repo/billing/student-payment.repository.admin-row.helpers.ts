/**
 * StudentPaymentRepository admin-audit row mapper — the raw pgEnum →
 * canonical TS enum narrowing behind `listForAdminAudit`, extracted from
 * `student-payment.repository.ts` following the sibling
 * `student.repository.*.helpers.ts` extraction convention: the public
 * surface stays the `StudentPaymentRepository` namespace in
 * `student-payment.repository.ts` (this module backs the namespace's admin
 * mapper as a one-to-one delegation target). Nothing in this module is part
 * of the public API.
 */

import type { paymentGateway, paymentStatus } from "@/backend/db/schema/enums";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { ConflictError } from "@/backend/lib/errors";
import type { AdminStudentPaymentRow } from "@/backend/types";

/**
 * The raw pgEnum string-literal unions carried by the `$inferSelect`
 * projection — the type-level narrowing source for the admin row mapper
 * (lexically identical values, the same pure type-level narrowing the
 * wallet repository's settlement-probe mappers perform).
 */
type PgPaymentStatus = (typeof paymentStatus)["enumValues"][number];
type PgPaymentGateway = (typeof paymentGateway)["enumValues"][number];

/**
 * The map arms from the raw pgEnum string-literal unions to the canonical
 * TS enums (lexically identical values). `Record` over the union makes the
 * mapping exhaustive — a schema/pgEnum change that adds or renames a value
 * fails the type check here instead of slipping through at runtime.
 */
const PAYMENT_STATUS_BY_PG_VALUE: Record<PgPaymentStatus, PaymentStatus | undefined> = {
  pending: PaymentStatus.Pending,
  paid: PaymentStatus.Paid,
  refunded: PaymentStatus.Refunded,
  failed: PaymentStatus.Failed,
};

const PAYMENT_GATEWAY_BY_PG_VALUE: Record<PgPaymentGateway, PaymentGateway | undefined> = {
  stripe: PaymentGateway.Stripe,
  paypal: PaymentGateway.Paypal,
  paymob: PaymentGateway.Paymob,
  fawry: PaymentGateway.Fawry,
  offline_cash: PaymentGateway.OfflineCash,
  bank_transfer: PaymentGateway.BankTransfer,
  scholarship: PaymentGateway.Scholarship,
  other: PaymentGateway.Other,
  mock: PaymentGateway.Mock,
};

/**
 * Narrows the raw `$inferSelect` pgEnum string-literal unions to the
 * canonical TS enums via the exhaustive map arms above (lexically identical
 * values — the same pure type-level narrowing the wallet repository's
 * settlement-probe mappers perform). An unrecognized value is a hard error,
 * never a silent fallback — the pgEnum constraint makes it unreachable, so
 * reaching it means a broken schema contract that must surface loudly.
 */
function toAdminPaymentStatusEnum(status: PgPaymentStatus): PaymentStatus {
  const mapped = PAYMENT_STATUS_BY_PG_VALUE[status];
  if (mapped === undefined) {
    throw new ConflictError(
      `StudentPaymentRepository: unrecognized payment status value ${JSON.stringify(status)} — the pgEnum constraint makes this unreachable`
    );
  }
  return mapped;
}

function toAdminPaymentGatewayEnum(gateway: PgPaymentGateway): PaymentGateway {
  const mapped = PAYMENT_GATEWAY_BY_PG_VALUE[gateway];
  if (mapped === undefined) {
    throw new ConflictError(
      `StudentPaymentRepository: unrecognized payment gateway value ${JSON.stringify(gateway)} — the pgEnum constraint makes this unreachable`
    );
  }
  return mapped;
}

/**
 * Narrows one joined admin-audit row to the canonical TS-enum shape. The
 * student owner rides in as nullable (the widened ledger column) but cannot
 * be null in a row that survived the `students` INNER join — reaching null
 * means a broken join contract, so it raises loudly instead of rendering an
 * owner-less row (the same hard-error posture as the pgEnum narrowers
 * above).
 */
export function toAdminPaymentRow(row: {
  id: number;
  studentId: number | null;
  subscriptionId: number | null;
  amount: string;
  currency: string;
  paymentGateway: PgPaymentGateway;
  status: PgPaymentStatus;
  providerTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  studentName: string;
}): AdminStudentPaymentRow {
  if (row.studentId === null) {
    throw new ConflictError(
      "StudentPaymentRepository: admin audit row has no student owner — the students inner join makes this unreachable"
    );
  }
  return {
    ...row,
    studentId: row.studentId,
    status: toAdminPaymentStatusEnum(row.status),
    paymentGateway: toAdminPaymentGatewayEnum(row.paymentGateway),
  };
}
