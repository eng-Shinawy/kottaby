/**
 * Type-Level Shape Proof Suite for the student handshake canonical types.
 * Validated by `bun tsgo` (the compiler is the test runner).
 * `.test-d.ts` suffix = outside bun test runner glob.
 *
 * POSITIVES use `satisfies` — must compile.
 * NEGATIVES use `@ts-expect-error` directly before the offending line.
 */
import type { HandshakeCodeLookupReturnType, HandshakeDiscoveryRowType } from "@/backend/types/students/student.types";

/** Exact type equality via mutual assignability of tuple-wrapped operands. */
type Equal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

// Helper to consume variables for TS6133
const v = (x: unknown): boolean => Boolean(x);

// ========== HandshakeCodeLookupReturnType (parent-facing payload) ==========

// Anchor — EXACT key set: maskedName + linkable, nothing else.
// A future additive field (e.g. an `id`) breaks this line FIRST.
const lookupKeysExact: Equal<keyof HandshakeCodeLookupReturnType, "maskedName" | "linkable"> = true;
v(lookupKeysExact);

// Positive — the full payload satisfies the canonical return type.
v({ maskedName: "A***", linkable: true } satisfies HandshakeCodeLookupReturnType);

// Positive — the payload is assignable to the canonical return type.
const lookupPayload: HandshakeCodeLookupReturnType = { maskedName: "أ***", linkable: false };
v(lookupPayload);

// Negative — database identity is forbidden on the payload.
// @ts-expect-error — `id` must never exist on the lookup payload
const lookupId: HandshakeCodeLookupReturnType["id"] = 1;
v(lookupId);

// Negative — contact fields are forbidden on the payload.
// @ts-expect-error — `email` must never exist on the lookup payload
const lookupEmail: HandshakeCodeLookupReturnType["email"] = "student@example.com";
v(lookupEmail);

// Negative — the raw parent FK is forbidden on the payload (linkable signal only).
// @ts-expect-error — `parentId` must never exist on the lookup payload
const lookupParentId: HandshakeCodeLookupReturnType["parentId"] = 42;
v(lookupParentId);

// Negative — governance state is forbidden on the payload.
// @ts-expect-error — `isDeleted` must never exist on the lookup payload
const lookupIsDeleted: HandshakeCodeLookupReturnType["isDeleted"] = false;
v(lookupIsDeleted);

// Negative — maskedName stays a string.
// @ts-expect-error — maskedName is a string, not a number
const numericMaskedName: HandshakeCodeLookupReturnType["maskedName"] = 123;
v(numericMaskedName);

// Negative — linkable stays a boolean.
// @ts-expect-error — linkable is a boolean, not a string
const textualLinkable: HandshakeCodeLookupReturnType["linkable"] = "yes";
v(textualLinkable);

// Negative — a key may never be dropped from the payload.
// @ts-expect-error — linkable is mandatory
const incompleteLookup: HandshakeCodeLookupReturnType = { maskedName: "A***" };
v(incompleteLookup);

// Negative — the payload is readonly: fields cannot be reassigned.
// @ts-expect-error — maskedName is readonly
lookupPayload.maskedName = "B***";
v(lookupPayload);

// ========== HandshakeDiscoveryRowType (service-internal join row) ==========

// Anchor — EXACT key set: the seven joined columns, nothing else.
const discoveryKeysExact: Equal<
  keyof HandshakeDiscoveryRowType,
  "parentId" | "fullName" | "isDeleted" | "isBlocked" | "suspended" | "suspendedAt" | "suspendedPeriodDays"
> = true;
v(discoveryKeysExact);

// Anchor — parentId keeps its nullable FK type (number | null); null = unlinked.
const discoveryParentIdType: Equal<HandshakeDiscoveryRowType["parentId"], number | null> = true;
v(discoveryParentIdType);

// Anchor — fullName keeps its non-null string type (the mask input).
const discoveryFullNameType: Equal<HandshakeDiscoveryRowType["fullName"], string> = true;
v(discoveryFullNameType);

// Positive — a full joined row (unlinked student) satisfies the discovery shape.
v({
  parentId: null,
  fullName: "Test Student",
  isDeleted: false,
  isBlocked: false,
  suspended: false,
  suspendedAt: null,
  suspendedPeriodDays: null,
} satisfies HandshakeDiscoveryRowType);

// Positive — a linked, governed student row also satisfies the discovery shape.
v({
  parentId: 42,
  fullName: "طالب آخر",
  isDeleted: false,
  isBlocked: true,
  suspended: true,
  suspendedAt: new Date(),
  suspendedPeriodDays: 7,
} satisfies HandshakeDiscoveryRowType);

// Negative — no database identity on the discovery row.
// @ts-expect-error — `id` is not part of the discovery row
const discoveryId: HandshakeDiscoveryRowType["id"] = 1;
v(discoveryId);

// Negative — the handshake code itself does not ride along on the row.
// @ts-expect-error — `handshakeCode` is not part of the discovery row
const discoveryHandshakeCode: HandshakeDiscoveryRowType["handshakeCode"] = "KSB-00000000";
v(discoveryHandshakeCode);

// Negative — no contact fields on the discovery row.
// @ts-expect-error — `email` is not part of the discovery row
const discoveryEmail: HandshakeDiscoveryRowType["email"] = "student@example.com";
v(discoveryEmail);

// Negative — no credential fields on the discovery row.
// @ts-expect-error — `passwordHash` is not part of the discovery row
const discoveryPasswordHash: HandshakeDiscoveryRowType["passwordHash"] = "hash";
v(discoveryPasswordHash);

// Negative — suspendedAt stays a Date (timestamp column), not a string.
// @ts-expect-error — suspendedAt is Date | null, not a string
const discoverySuspendedAt: HandshakeDiscoveryRowType["suspendedAt"] = "2026-01-01";
v(discoverySuspendedAt);

// Negative — a key may never be dropped from the discovery row.
// @ts-expect-error — suspendedPeriodDays is mandatory
const incompleteDiscovery: HandshakeDiscoveryRowType = {
  parentId: null,
  fullName: "Test Student",
  isDeleted: false,
  isBlocked: false,
  suspended: false,
  suspendedAt: null,
};
v(incompleteDiscovery);
