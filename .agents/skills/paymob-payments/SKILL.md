---
name: paymob-payments
description: >-
  Integrate, configure, or debug Paymob (Accept) — the Egypt-first MENA payment gateway (also KSA, UAE, Oman, Pakistan). Use whenever work touches Paymob: Intention API (v1/intention), Unified Checkout or Pixel, auth tokens / secret keys, transaction callbacks or webhooks, HMAC verification, refunds/voids/captures, saved cards (CIT/MIT, tokens), subscriptions, QuickLinks/payment links, transaction inquiry, mobile wallets (Vodafone Cash etc.), kiosk/Aman, BNPL, installments, Apple Pay via Paymob, plugins (WooCommerce, Shopify, Odoo, Magento), mobile SDKs, or accept.paymob.com generally. Also trigger for "online payments in Egypt", "EGP card payments", "payment gateway for Egyptian customers", or checkout flows for luminaai.company — even if the user says only "Paymob". Bundles an offline mirror of developers.paymob.com/paymob-docs (116 pages) plus a cheatsheet — consult these instead of guessing endpoints, request shapes, HMAC key order, or test credentials.
---

# Paymob Payments

Paymob ("Accept") is the dominant Egyptian payment gateway: cards (3DS), mobile
wallets (Vodafone Cash & co.), BNPL, bank installments, kiosk (Aman/Masary),
Apple Pay. The modern integration path is **Intention API → Unified Checkout
(redirect) or Pixel (embedded) → webhook callbacks with HMAC verification**.

## Bundled references — read these, don't guess

- `references/cheatsheet.md` — condensed integration guide: every endpoint with
  auth mode and request shape, HMAC algorithm + exact key order, checkout URL
  format, test credentials, Lumina/Next.js wiring plan. **Start here.**
- `references/docs/INDEX.md` — table of contents of the full offline docs
  mirror (116 pages from developers.paymob.com, both tabs, with per-page
  `METHOD endpoint` annotations).
- `references/docs/**/*.md` — the mirrored pages themselves. Each file has
  frontmatter with the live `url:` and `breadcrumbs:`. Grep this tree for any
  API detail; every API page carries full request/response schemas with
  examples, plus documented common errors.

Key pages you will reach for most:

| Topic | File |
|---|---|
| Create Intention (the core API) | `references/docs/intention-apis/create-intention.md` |
| Unified Checkout redirect | `references/docs/checkout-experiences/unified-checkout-redirection.md` |
| Pixel (embedded checkout) | `references/docs/checkout-experiences/pixel-embedded.md` |
| Callbacks (processed vs response) | `references/docs/webhook-callbacks-and-hmac/transaction-callbacks.md` |
| HMAC for transaction callbacks | `references/docs/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback.md` |
| HMAC for card-token callbacks | `references/docs/webhook-callbacks-and-hmac/hmac/hmac-for-card-tokens.md` |
| Refund / Void / Capture | `references/docs/manage-payment-apis/*.md` |
| Saved cards (token, CIT, MIT) | `references/docs/pay-with-saved-cards/*.md` |
| Subscriptions (plans + actions) | `references/docs/subscription/**` |
| Transaction inquiry | `references/docs/transaction-inquiry-apis/*.md` |
| Test cards & wallet | `references/docs/need-help/faq/test-credentials.md` |
| Where credentials live in dashboard | `references/docs/need-help/faq/getting-integration-credentials.md` |

## Core concepts (60-second model)

- **Region hosts**: Egypt `https://accept.paymob.com/` (default for Lumina),
  KSA `https://ksa.paymob.com/`, UAE `https://uae.paymob.com/`, Oman
  `https://oman.paymob.com/`. Doc endpoint paths are relative to these.
- **Four credentials**, all from the Accept Dashboard (Settings):
  - **Secret key** `sk_test_…`/`sk_live_…` → header `Authorization: Token <sk>`
    for Intention API and refund/void/capture. Server-side only.
  - **Public key** `pk_…` → used in the checkout URL / Pixel. Safe for client.
  - **API key** → exchanged via `POST api/auth/tokens` for a Bearer token;
    needed only for subscriptions, QuickLinks, and transaction inquiry.
  - **HMAC secret** → verifies callbacks. Server-side only.
- **Integration IDs**: one per payment method/currency, separate Test and Live
  sets (Dashboard → Developers → Payment Integrations). The test/live status of
  the integration ID **must match** the secret key used — mismatch is the
  classic 404 `"Integration ID/Name does not exist"` error.
- **Amounts are integer cents** (EGP piasters): 1500 EGP → `150000`. The sum of
  `items[].amount` must equal `amount`.
- **Happy path**: server creates intention (`POST v1/intention/`) → gets
  `client_secret` → redirect customer to
  `https://accept.paymob.com/unifiedcheckout/?publicKey=<pk>&clientSecret=<cs>`
  → Paymob POSTs the **processed callback** (JSON, server-to-server) to your
  webhook and GET-redirects the customer to your **response callback** page →
  verify HMAC (SHA-512) on both → fulfill **only** on the processed callback.

## Rules that prevent real bugs

1. **Fulfill on the processed callback, never on the redirect.** The response
   callback is client-side and spoofable; the processed callback with a valid
   HMAC is the source of truth. Check `success == true` **and** that
   `amount_cents` and `currency` match what you stored for the order.
2. **HMAC**: concatenate the *values* of the documented 19 keys in their exact
   documented (lexicographic) order — booleans as lowercase `true`/`false` —
   then HMAC-SHA512 with the HMAC secret and compare to the `hmac` query
   param. POST callback reads nested `obj.id`/`order.id`; GET callback uses
   flat `id`/`order_id`. Exact list in the cheatsheet.
3. **Correlate via `special_reference`** (returned as `merchant_order_id` in
   callbacks) or store `intention_order_id`/intention `id` at creation time.
   `special_reference` must be unique per intention — reuse is rejected, which
   makes it a natural idempotency key.
4. **Don't hardcode integration IDs in code** — env vars, one per method, and
   keep test/live pairs separate per environment.
5. `payment_methods` accepts integration IDs (numbers) or names (strings, e.g.
   `"card"`). Currency of the intention must match the integration ID currency.
6. Per-intention `notification_url`/`redirection_url` override the dashboard
   callback URLs but are **card-only** (redirection also works for wallets) —
   set the dashboard URLs anyway as the baseline.
7. Webhooks need a public URL — use the dashboard's webhook testing tool, or
   ngrok/webhook.site locally (`references/docs/webhook-callbacks-and-hmac/webhook-testing-tool.md`).

## Lumina-specific wiring (Next.js 16 + Supabase, this repo)

When implementing here, follow the repo conventions (App Router, route
handlers, hooks in `hooks/`, Supabase service-role only server-side):

- `app/api/paymob/intention/route.ts` — POST: authenticated student requests
  enrollment payment → server creates intention (secret key, EGP cents from
  the course pricing source of truth) → returns checkout URL. Never expose
  `sk_` to the client.
- `app/api/paymob/webhook/route.ts` — processed-callback receiver: verify
  HMAC before parsing, then activate the enrollment with the **service-role**
  Supabase client (no user session in webhooks; RLS must be bypassed
  deliberately), record the transaction id, and return 200 fast.
- `app/[locale]/(student)/payment/result/page.tsx` (or similar) — response
  callback landing page: parse query params, verify HMAC server-side, show
  localized success/failure (AR default, RTL).
- Env vars (set on the **`lumina-ai-academy`** Vercel project — that's the one
  serving luminaai.company, not `lumina-academy-platform`):
  `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`,
  `PAYMOB_INTEGRATION_ID_CARD`, `PAYMOB_INTEGRATION_ID_WALLET`
  (+ `PAYMOB_API_KEY` only if subscriptions/inquiry get used).
- Payments table in Supabase keyed by intention id / `special_reference` =
  enrollment id; status transitions only from webhook handler.

## Test credentials (test mode)

Cards — holder `Test Account`, expiry `01/39`, CVV `123`:
Mastercard `5123456789012346` or `5123450000000008`, Visa `4111111111111111`.
Mobile wallet — number `01010101010`, MPin `123456`, OTP `123456`.

## Mirror maintenance

The mirror was generated 2026-06-11 from the live Theneo site. To refresh:
re-run the fetch+convert pipeline (see `references/MIRROR.md`) — it enumerates
pages from the site's `__NEXT_DATA__` section map, so new pages are picked up
automatically.
