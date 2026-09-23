/**
 * Static Structural Assertions Suite — billing gateway port types +
 * Paymob vendor DTOs. bun:test file-content scans enforcing structural
 * invariants (vendor field names, amendment shapes, types-only posture).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TYPES_DIR = join(__dirname);

/** Files to scan (library files only, NOT test files). */
const LIB_FILES = ["paymob.types.ts", "payment-gateway.types.ts", "index.ts"];

/**
 * The vendor's signed HMAC message values for a processed transaction
 * callback — flat keys read verbatim off the transaction object.
 */
const TRANSACTION_HMAC_FLAT_KEYS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order",
  "owner",
  "pending",
  "source_data",
  "success",
];

/** The vendor's signed HMAC message values for a card-token callback. */
const TOKEN_HMAC_KEYS = ["card_subtype", "created_at", "email", "id", "masked_pan", "merchant_id", "order_id", "token"];

async function readLibFiles(): Promise<Map<string, string>> {
  const entries = await Promise.all(
    LIB_FILES.map(async f => [f, await readFile(join(TYPES_DIR, f), "utf-8")] as const)
  );
  return new Map(entries);
}

/** Strict file lookup — a missing file fails the suite instead of yielding undefined. */
function libCode(files: Map<string, string>, name: string): string {
  const content = files.get(name);
  if (content === undefined) {
    throw new Error(`missing lib file: ${name}`);
  }
  return content;
}

/** Strips comment lines so prose mentions don't trip structural scans. */
function codeLines(content: string): string[] {
  return content
    .split("\n")
    .filter(l => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"));
}

/** Extracts `content.slice(bodyStart, bodyEnd)` for the interface block starting at matchIndex. */
function sliceInterfaceBody(content: string, matchIndex: number): string {
  const bodyStart = content.indexOf("{", matchIndex);
  const braceCount = { count: 0 };
  let bodyEnd = bodyStart;
  for (let i = bodyStart; i < content.length; i++) {
    if (content[i] === "{") braceCount.count++;
    if (content[i] === "}") braceCount.count--;
    if (braceCount.count === 0) {
      bodyEnd = i;
      break;
    }
  }
  return content.slice(bodyStart, bodyEnd);
}

/** Body of the named interface declaration ("" when absent — callers assert on it). */
function interfaceBody(code: string, declaration: RegExp): string {
  const match = declaration.exec(code);
  if (!match) {
    return "";
  }
  return sliceInterfaceBody(code, match.index);
}

/** Counts member declarations inside an interface body (anchored to member lines). */
function memberCount(body: string): number {
  // Linear scan (no regex): member lines are exactly two-space indented `readonly` declarations.
  return body.split("\n").filter(l => l.startsWith("  readonly ")).length;
}

describe("Billing gateway types — Static Structural Assertions", () => {
  let files: Map<string, string>;

  beforeAll(async () => {
    files = await readLibFiles();
  });

  test("1. Paymob intention request mirrors the vendor's exact members (snake_case)", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymobIntentionRequest\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly amount: number;");
    expect(body).toContain("readonly currency: string;");
    expect(body).toContain("readonly payment_methods: number[];");
    expect(body).toContain("readonly items: PaymobIntentionItem[];");
    expect(body).toContain("readonly billing_data: PaymobBillingData;");
    expect(body).toContain("readonly special_reference: string;");
    expect(body).toContain("readonly notification_url?: string;");
    expect(body).toContain("readonly redirection_url?: string;");
    expect(memberCount(body)).toBe(8);

    const billingBody = interfaceBody(code, /export interface PaymobBillingData\b/);
    expect(billingBody).toContain("readonly first_name: string;");
    expect(billingBody).toContain("readonly last_name: string;");
    expect(billingBody).toContain("readonly email: string;");
    expect(billingBody).toContain("readonly phone_number: string;");
    expect(memberCount(billingBody)).toBe(11);
  });

  test("2. Intention response carries the checkout-redirect contract (id + client_secret)", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymobIntentionResponse\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly id: string;");
    expect(body).toContain("readonly client_secret: string;");
    expect(body).toContain("readonly intention_order_id: number;");
    expect(body).toContain("readonly special_reference: string;");
  });

  test("3. Processed transaction callback object carries every signed HMAC value", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymobTransactionCallbackObj\b/);
    expect(body).not.toBe("");

    for (const key of TRANSACTION_HMAC_FLAT_KEYS) {
      expect(body).toMatch(new RegExp(`readonly\\s+"?${key}"?\\s*:`, "u"));
    }
    // Nested members the dotted HMAC keys address.
    expect(body).toContain("readonly order: PaymobTransactionOrder;");
    expect(body).toContain("readonly source_data: PaymobTransactionSourceData;");

    const orderBody = interfaceBody(code, /export interface PaymobTransactionOrder\b/);
    expect(orderBody).toContain("readonly id: number;");
    expect(orderBody).toContain("readonly merchant_order_id: string | null;");

    const sourceBody = interfaceBody(code, /export interface PaymobTransactionSourceData\b/);
    expect(sourceBody).toContain("readonly pan: string;");
    expect(sourceBody).toContain("readonly sub_type: string;");
    expect(sourceBody).toContain("readonly type: string;");
  });

  test("4. Card-token callback object carries exactly the signed token keys", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymobTokenCallbackObj\b/);
    expect(body).not.toBe("");

    for (const key of TOKEN_HMAC_KEYS) {
      expect(body).toContain(`readonly ${key}:`);
    }
  });

  test("5. Card-token body is a typed delivery envelope", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    const body = interfaceBody(code, /interface PaymobTokenCallbackBody\b/);
    expect(body).not.toBe("");
    expect(body).toContain("readonly type?: string;");
    expect(body).toContain("readonly obj: PaymobTokenCallbackObj;");
  });

  test("6. Transaction inquiry result carries the reconciliation routing subset", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymobTransactionInquiryResult\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly id: number;");
    expect(body).toContain("readonly pending: boolean;");
    expect(body).toContain("readonly success: boolean;");
    expect(body).toContain("readonly amount_cents: number;");
    expect(body).toContain("readonly currency: string;");
    expect(body).toContain("readonly order: PaymobTransactionOrder;");
  });

  test("7. Resolved provider config is camelCase with every adapter-required member", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymobResolvedConfig\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly secretKey: string;");
    expect(body).toContain("readonly publicKey: string;");
    expect(body).toContain("readonly hmacSecret: string;");
    expect(body).toContain("readonly apiKey: string;");
    expect(body).toContain("readonly integrationIdCard: number;");
    expect(body).toContain("readonly integrationIdWallet: number | null;");
    expect(body).toContain("readonly apiBaseUrl: string;");
    expect(body).toContain("readonly checkoutBaseUrl: string;");
    expect(body).toContain("readonly httpTimeoutMs: number;");
    expect(memberCount(body)).toBe(9);
  });

  test("8. Checkout input requires the correlation key + the server-derived billing identity", () => {
    const code = codeLines(libCode(files, "payment-gateway.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymentCheckoutInput\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly studentId: number;");
    expect(body).toContain("readonly planId: number;");
    expect(body).toContain("readonly amount: string;");
    expect(body).toContain("readonly currency: string;");
    expect(body).toContain("readonly specialReference: string;");
    expect(body).toContain("readonly billing: {");
    expect(body).toContain("readonly firstName: string;");
    expect(body).toContain("readonly lastName: string;");
    expect(body).toContain("readonly email: string;");
    expect(body).toContain("readonly phone: string | null;");
    expect(memberCount(body)).toBe(6);
  });

  test("9. Webhook event optionally carries the provider transaction id", () => {
    const code = codeLines(libCode(files, "payment-gateway.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface PaymentWebhookEvent\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly providerTransactionId?: string;");
    expect(memberCount(body)).toBe(5);
  });

  test("10. Port parse input is { rawBody, query } and the parser may report null", () => {
    const code = codeLines(libCode(files, "payment-gateway.types.ts")).join("\n");
    const body = interfaceBody(code, /export interface WebhookParseInput\b/);
    expect(body).not.toBe("");

    expect(body).toContain("readonly rawBody: string;");
    expect(body).toContain("readonly query: Record<string, string | undefined>;");
    expect(memberCount(body)).toBe(2);

    const portBody = interfaceBody(code, /export interface PaymentGatewayPort\b/);
    expect(portBody).toContain("createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutSession>;");
    expect(portBody).toContain("parseWebhookEvent(input: WebhookParseInput): PaymentWebhookEvent | null;");
    // The replaced raw-body-only signature must be gone.
    expect(code).not.toContain("parseWebhookEvent(rawBody: string)");
  });

  test("11. Billing barrel re-exports the paymob vendor module", () => {
    const code = codeLines(libCode(files, "index.ts")).join("\n");
    expect(code).toContain('export * from "./paymob.types";');
    const lines = code
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^export \* from "\.\/[\w.-]+";$/);
    }
  });

  test("12. Paymob vendor module is types-only: zero imports, zero runtime", () => {
    const code = codeLines(libCode(files, "paymob.types.ts")).join("\n");
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toContain("export const");
    expect(code).not.toContain("export function");
    expect(code).not.toContain("=>");
    expect(code).not.toMatch(/\bany\b/);
    expect(code).not.toContain("as unknown");
  });

  test("13. Zero enum-value leakage, forbidden patterns, or plan-artifact references", () => {
    for (const name of ["paymob.types.ts", "payment-gateway.types.ts"]) {
      const content = libCode(files, name);
      const code = codeLines(content).join("\n");
      // Enum vocabulary stays in the enum modules — never a string literal here.
      expect(code).not.toContain('"paymob"');
      expect(code).not.toContain('"mock"');
      expect(code).not.toMatch(/\bany\b/);
      expect(code).not.toContain("as unknown");
      expect(code).not.toMatch(/console\./);
      expect(code).not.toMatch(/\blogger\b/);
      expect(code).not.toMatch(/\boxlint-disable\b/);
      expect(content).not.toMatch(/REQ-\d|DEV3-\d|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/);
    }
    // The port type references the gateway enum through a type-only import.
    const gatewayCode = libCode(files, "payment-gateway.types.ts");
    expect(gatewayCode).toContain('import type { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";');
  });
});
