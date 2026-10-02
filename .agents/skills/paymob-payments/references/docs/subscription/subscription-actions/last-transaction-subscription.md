---
title: "Last Transaction Subscription"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/last-transaction-subscription
tab: developers
breadcrumbs: "Subscription > Subscription actions > Last Transaction Subscription"
---

# Last Transaction Subscription
**Outcome** \- Retrieving the last transaction details associated with a specific subscription

* * *

### **Authorization**

You should send a valid auth token as a Bearer Token. 

> **Info:**
> 
> You can get a valid auth token by [**Authentication Request (Generate Auth Token)**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1)

* * *

#### Common errors


### Invalid Auth Token

401 Unauthorized

```json
{
   "detail":"incorrect credentials"
}
``` 

**Solution** : Make sure to pass a valid and fresh auth token. (Each auth token is valid for an hour)

* * *

## Endpoint

`GET api/acceptance/subscriptions/{Subscription_Id}/last-transaction`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_Id` (string) — **required** — which you need to retrieve its last transaction

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `516640`)_
- `pending` (boolean) — Indicates whether the transaction is still pending
- `amount_cents` (number) — Transaction amount in cents _(example: `200`)_
- `success` (boolean) — Indicates whether the transaction was successful
- `is_auth` (boolean) — Indicates if this is an authorization transaction
- `is_capture` (boolean) — Indicates if this is a capture transaction
- `is_standalone_payment` (boolean) — Indicates if this is a standalone payment _(example: `true`)_
- `is_voided` (boolean) — Indicates if the transaction has been voided
- `is_refunded` (boolean) — Indicates if the transaction has been refunded
- `is_3d_secure` (boolean) — Indicates if 3D Secure authentication was used
- `integration_id` (number) — The integration ID used for this transaction _(example: `14664`)_
- `terminal_id` (string)
- `terminal_branch_id` (string) _(example: `-`)_
- `has_parent_transaction` (boolean) — Indicates if this transaction has a parent transaction
- `created_at` (string) — Timestamp when the record was created _(example: `2024-09-13T00:00:27.037561+04:00`)_
- `paid_at` (string)
- `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
- `source_data` (object)
  - `type` (string) _(example: `card`)_
  - `pan` (string) _(example: `2346`)_
  - `sub_type` (string) _(example: `MasterCard`)_
  - `tenure` (string)
- `api_source` (string) _(example: `SUBSCRIPTION`)_
- `is_void` (boolean)
- `is_refund` (boolean)
- `is_cashout` (boolean)
- `data` (object)
  - `status_code` (number) _(example: `400`)_
  - `json` (object)
    - `error` (object)
      - `cause` (string) _(example: `INVALID_REQUEST`)_
      - `explanation` (string) _(example: `Value 'MERCHANT' is invalid. value: Merchant - reason: Merchant acquirer relationship does not support this Merchant ...`)_
      - `field` (string) _(example: `transaction.source`)_
      - `validationType` (string) _(example: `INVALID`)_
    - `result` (string) _(example: `ERROR`)_
  - `message` (string) _(example: `Value 'MERCHANT' is invalid. value: Merchant - reason: Merchant acquirer relationship does not support this Merchant ...`)_
  - `txn_response_code` (string) _(example: `ERROR`)_
  - `acq_response_code` (string) _(example: `-`)_
  - `gateway_integration_pk` (number) _(example: `14664`)_
- `is_hidden` (boolean) — Indicates if the transaction is hidden
- `error_occured` (boolean) — Indicates if an error occurred during processing _(example: `true`)_
- `is_live` (boolean) — Indicates if this is a live (production) transaction
- `other_endpoint_reference` (string) — Reference from external endpoint
- `refunded_amount_cents` (number) — The amount that has been refunded in cents
- `source_id` (number) — Source identifier _(example: `323`)_
- `is_captured` (boolean) — Indicates if the transaction has been captured
- `captured_amount` (number) — The amount that has been captured in cents
- `merchant_staff_tag` (string) — Staff tag for merchant tracking
- `updated_at` (string) — Timestamp when the record was last updated _(example: `2024-09-13T00:00:28.653814+04:00`)_
- `is_settled` (boolean) — Indicates if the transaction has been settled
- `bill_balanced` (boolean) — Indicates if the bill is balanced
- `is_bill` (boolean) — Indicates if this is a bill payment
- `owner` (number) — Owner identifier _(example: `10206`)_
- `order` (number) — Order details associated with this transaction _(example: `619658`)_
- `parent_transaction` (string) — Parent transaction ID

