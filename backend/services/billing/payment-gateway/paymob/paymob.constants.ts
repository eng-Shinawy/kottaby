/**
 * Paymob callback HMAC key lists — the provider's documented members whose
 * VALUES (never the names) concatenate, in exactly this order, into the
 * string that is then HMAC-SHA512-signed with the merchant's HMAC secret.
 * Each entry is a getter path relative to the object being signed: a plain
 * member name for flat members, a dotted path for nested ones.
 *
 * The two transaction lists carry the same twenty signed values and differ
 * only where the wire shapes diverge: the processed (POST) callback nests
 * the order id under its `order` object, while the response (GET) redirect
 * flattens it to a parameter. The vendor's own pages deliver that flat
 * order id under both `order` and `order_id`, so the GET list records the
 * canonical `order_id` slot and the query builder prefers `order` when it
 * is present. The transaction's own identity member is written `obj.id` in
 * the vendor's list because that list is framed on the whole callback body;
 * the builders here consume the transaction object itself, so it appears as
 * `id`. The token list is the vendor's separate eight-member card-token
 * ordering. The `error_occured` spelling is the vendor's own.
 */

/** Signed values of the processed (POST) transaction callback, in documented order. */
export const PAYMOB_TXN_HMAC_KEYS_POST: readonly string[] = [
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
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

/** Signed values of the response (GET) transaction redirect, flat parameter names. */
export const PAYMOB_TXN_HMAC_KEYS_GET: readonly string[] = [
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
  "order_id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

/** Signed values of the card-token (TOKEN) callback, in documented order. */
export const PAYMOB_TOKEN_HMAC_KEYS: readonly string[] = [
  "card_subtype",
  "created_at",
  "email",
  "id",
  "masked_pan",
  "merchant_id",
  "order_id",
  "token",
];
