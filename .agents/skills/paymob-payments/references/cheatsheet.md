# Paymob quick-reference cheatsheet

Condensed from the offline mirror under `docs/` (developers.paymob.com, fetched 2026-06-11).
Every claim here is sourced from a mirrored page — file paths given inline.

## Base URLs

| Region | Base |
|---|---|
| Egypt (Accept) | `https://accept.paymob.com/` |
| Saudi Arabia | `https://ksa.paymob.com/` |
| UAE | `https://uae.paymob.com/` |
| Oman | `https://oman.paymob.com/` |

All endpoint paths below are relative to the regional base. Lumina → Egypt.

## Credentials & auth modes

| Credential | Looks like | Used for | Header / usage |
|---|---|---|---|
| Secret key | `sk_test_…` / `sk_live_…` | Intention API, refund/void/capture, MIT | `Authorization: Token <sk>` |
| Public key | `pk_…` | Unified Checkout URL, Pixel | query param `publicKey` |
| API key | long base64 | auth-token exchange | body of `POST api/auth/tokens` |
| Auth token | from `api/auth/tokens` | subscriptions, QuickLink, transaction inquiry | `Authorization: Bearer <token>` |
| HMAC secret | hex string | verifying callbacks | HMAC-SHA512 key |

Dashboard locations: Settings tab (secret/public/API keys — test & live modes are
separate, API key is shared); Developers → Payment Integrations (integration IDs +
callback URLs). Source: `docs/need-help/faq/getting-integration-credentials.md`.

## Endpoint catalogue

### Payment flow (secret-key auth: `Authorization: Token sk_…`)

| Action | Endpoint | Notes |
|---|---|---|
| Create intention | `POST v1/intention/` | core API, see below |
| Update intention | `PUT v1/intention/{client_secret}/` | requires `accept_order_id` |
| Refund | `POST api/acceptance/void_refund/refund` | body `{transaction_id, amount_cents}` — partial OK |
| Void | `POST api/acceptance/void_refund/void` | body `{transaction_id}` — same-day, pre-settlement |
| Capture | `POST api/acceptance/capture` | for auth/cap integrations |
| MIT (charge saved card) | `POST api/acceptance/payments/pay` | `source: {identifier: <card_token>, subtype: "TOKEN"}` |

### Checkout (public key, client-side)

| Action | URL |
|---|---|
| Unified Checkout redirect | `GET {base}unifiedcheckout/?publicKey=<pk>&clientSecret=<client_secret>` |
| Payment status page | `{base}unifiedcheckout/payment-status?...` |
| Pixel (embedded) | npm component — see `docs/checkout-experiences/pixel-embedded.md` |

### Bearer-token APIs (first call `POST api/auth/tokens` with `{"api_key": …}` → `token`)

| Action | Endpoint |
|---|---|
| Transaction inquiry by ID | `GET api/acceptance/transactions/{transaction_id}` |
| Inquiry by order/merchant ref | `POST api/ecommerce/orders/transaction_inquiry` |
| Create QuickLink (payment link) | `POST api/ecommerce/payment-links` |
| Cancel QuickLink | `POST api/ecommerce/payment-links/cancel` |
| Create subscription plan | `POST api/acceptance/subscription-plans` |
| Plan actions | `PUT/GET …/subscription-plans/{id}`, `POST …/{id}/suspend`, `POST …/{id}/resume` |
| Subscription actions | `GET/PUT api/acceptance/subscriptions/{id}`, `POST …/{id}/suspend|resume|cancel`, cards: `GET …/{id}/card-tokens`, `POST …/{id}/delete-card`, `POST …/{id}/change-primary-card`, webhook: `POST …/{id}/register_webhook`, `GET …/{id}/last-transaction`, `GET …/{id}/transactions` |

## Create Intention — the core call

`POST {base}v1/intention/` · `Authorization: Token sk_…` · JSON
(full schema + documented common errors: `docs/intention-apis/create-intention.md`)

```jsonc
{
  "amount": 150000,                  // REQUIRED — integer cents (1500 EGP)
  "currency": "EGP",                 // REQUIRED — must match integration ID currency
  "payment_methods": [123456, "card"], // REQUIRED — integration IDs (int) or names (string)
  "items": [                         // optional; if present, sum(items.amount) == amount
    { "name": "AI Diploma", "amount": 150000, "description": "…", "quantity": 1 }
  ],
  "billing_data": {                  // first_name, last_name, email REQUIRED
    "first_name": "Ahmed", "last_name": "Aly",
    "email": "a@b.com", "phone_number": "+201010101010"
  },
  "special_reference": "enr_8f3a…",  // unique → returned as merchant_order_id (idempotency)
  "extras": { "enrollment_id": "…" },// echoed back in payment key claims
  "expiration": 3600,                // seconds
  "notification_url": "https://…/api/paymob/webhook",   // card-only override
  "redirection_url": "https://…/ar/payment/result"      // card+wallet override
}
```

Response 201 essentials: `client_secret` (→ checkout URL), `id` (`pi_…` intention
id), `intention_order_id` (Paymob order id — appears as `order.id` in callbacks),
`payment_keys[]`, `status: "intended"`.

Documented common errors:
- 404 `Integration ID/Name does not exist…` → integration ID wrong, not yours, or test/live mismatch with the secret key.
- 400 `items.name/amount required`, `billing_data.phone_number required`, amount mismatch with items sum.

## Callbacks (webhooks)

Source: `docs/webhook-callbacks-and-hmac/transaction-callbacks.md`

| | Processed callback | Response callback |
|---|---|---|
| Type | `POST` JSON (server→server) | `GET` query params (customer redirect) |
| Set where | Integration ID config (dashboard) or `notification_url` | dashboard or `redirection_url` |
| Purpose | **fulfillment source of truth** | show success/failure page |
| HMAC | `?hmac=` query param | `hmac` query param |

Key fields: `obj.id` (transaction id), `success`, `pending`, `order.id`,
`amount_cents`, `currency`, `is_refunded`, `refunded_amount_cents`, `is_voided`,
`is_captured`, `captured_amount`, `merchant_order_id` (= your `special_reference`),
`payment_key_claims.extra` (= your `extras`).

A transaction-processed callback also fires on refund/void/capture actions.

## HMAC verification (SHA-512)

Source: `docs/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback.md`

1. Take the values of exactly these keys, in exactly this order
   (POST: from nested JSON `obj`; GET: flat query params):

```
amount_cents, created_at, currency, error_occured, has_parent_transaction,
obj.id (POST) | id (GET), integration_id, is_3d_secure, is_auth, is_capture,
is_refunded, is_standalone_payment, is_voided,
order.id (POST) | order_id (GET), owner, pending,
source_data.pan, source_data.sub_type, source_data.type, success
```

2. Concatenate values into one string — booleans as lowercase `true`/`false`.
3. `HMAC_SHA512(concatenated, HMAC_SECRET)` → hex.
4. Constant-time compare with the `hmac` query parameter.

```ts
import { createHmac, timingSafeEqual } from "crypto";

const HMAC_KEYS = [
  "amount_cents","created_at","currency","error_occured","has_parent_transaction",
  "id","integration_id","is_3d_secure","is_auth","is_capture","is_refunded",
  "is_standalone_payment","is_voided","order.id","owner","pending",
  "source_data.pan","source_data.sub_type","source_data.type","success",
] as const;

function get(obj: any, path: string) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

export function verifyPaymobHmac(txObj: any, receivedHmac: string): boolean {
  const concatenated = HMAC_KEYS.map((k) => {
    const v = get(txObj, k);
    return typeof v === "boolean" ? String(v) : v ?? "";
  }).join("");
  const digest = createHmac("sha512", process.env.PAYMOB_HMAC_SECRET!)
    .update(concatenated).digest("hex");
  return digest.length === receivedHmac?.length &&
    timingSafeEqual(Buffer.from(digest), Buffer.from(receivedHmac));
}
// POST processed callback: txObj = body.obj (nested order.id).
// GET response callback: build txObj from query params, using flat
// `id` and `order_id` (map "order.id" -> params.order) per the docs.
```

Card-token callback has a different key list (`card_subtype, created_at, email,
id, masked_pan, merchant_id, order_id, token`) —
`docs/webhook-callbacks-and-hmac/hmac/hmac-for-card-tokens.md`.
Subscription callback HMAC: `docs/subscription/hmac-calculation-for-subscription-callback.md`.

## Saved cards (CIT / MIT)

Source: `docs/pay-with-saved-cards/*.md`

1. **Create token**: create intention with a card integration of type
   Verification / Normal 3DS / Auth → customer pays once via checkout → card
   token arrives on your `notification_url` endpoint (card-token callback).
2. **CIT** (customer present): create intention with `card_tokens: ["<token>"]`
   (max 3) → checkout shows the saved card; integration types Normal 3DS / Auth
   / Card On File.
3. **MIT** (merchant-initiated, no customer): `POST api/acceptance/payments/pay`
   with secret key, `source: { identifier: <card_token>, subtype: "TOKEN" }`.

## Test credentials (test mode)

Source: `docs/need-help/faq/test-credentials.md`

| Method | Values |
|---|---|
| Mastercard | `5123456789012346` or `5123450000000008` — `Test Account`, exp `01/39`, CVV `123` |
| Visa | `4111111111111111` — same holder/exp/CVV |
| Mobile wallet | number `01010101010`, MPin `123456`, OTP `123456` |

## Recommended Lumina flow (Next.js 16 App Router + Supabase)

```
student clicks "ادفع الآن"
  → POST /api/paymob/intention   (route handler, Token sk_, amount from course pricing)
      - insert payments row {enrollment_id, special_reference, amount_cents, status:'pending'}
      - create intention; store intention_id + intention_order_id
      - return { checkoutUrl: `https://accept.paymob.com/unifiedcheckout/?publicKey=…&clientSecret=…` }
  → client redirects (window.location)
customer pays on Paymob
  → POST /api/paymob/webhook     (processed callback)
      - verifyPaymobHmac(body.obj, query.hmac)  → 401 if invalid
      - idempotent update by merchant_order_id: success && amount/currency match
        → payments.status='paid', activate enrollment (service-role client)
      - respond 200 quickly
  → GET /{locale}/payment/result (response callback / redirection_url)
      - server component verifies hmac over query params, shows localized status
      - never fulfills — display only
```

Gotchas specific to this stack:
- Webhook route: `export async function POST(req: NextRequest)` — read the raw
  JSON once; the `hmac` arrives as a **query param** even on POST.
- Supabase service-role client required in the webhook (no cookies/session).
- Env vars go on the `lumina-ai-academy` Vercel project (serves luminaai.company).
- Course prices are in `messages/ar.json`/`en.json` under `home.pricing` — keep
  the server-side amount source authoritative, never trust a client-sent amount.
- AR-default routing: redirection URLs must be locale-prefixed (`/ar/…`).
