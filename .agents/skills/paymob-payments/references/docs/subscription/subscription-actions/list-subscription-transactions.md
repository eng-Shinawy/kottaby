---
title: "List Subscription Transactions"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/list-subscription-transactions
tab: developers
breadcrumbs: "Subscription > Subscription actions > List Subscription Transactions"
---

# List Subscription Transactions
**Outcome** - Retrieve all transactions associated with a specific subscription ID.

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

`GET api/acceptance/subscriptions/{Subscription_id}/transactions`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_id` (string) — **required** — which you need to retrieve its transactions

### Response 200 — Successful response

- `next` (string) _(example: `https://accept.paymob.com/api/acceptance/subscriptions/2046/transactions?page=2`)_
- `previous` (string)
- `results` (array)
  - `0` (array)
    - `id` (number) — Unique identifier for the transaction _(example: `397730312`)_
    - `pending` (boolean) — Indicates whether the transaction is still pending
    - `amount_cents` (number) — Transaction amount in cents _(example: `20000`)_
    - `success` (boolean) — Indicates whether the transaction was successful
    - `is_auth` (boolean) — Indicates if this is an authorization transaction
    - `is_capture` (boolean) — Indicates if this is a capture transaction
    - `is_standalone_payment` (boolean) — Indicates if this is a standalone payment _(example: `true`)_
    - `is_voided` (boolean) — Indicates if the transaction has been voided
    - `is_refunded` (boolean) — Indicates if the transaction has been refunded
    - `is_3d_secure` (boolean) — Indicates if 3D Secure authentication was used
    - `integration_id` (number) — The integration ID used for this transaction _(example: `2002433`)_
    - `terminal_id` (string)
    - `terminal_branch_id` (string) _(example: `-`)_
    - `has_parent_transaction` (boolean) — Indicates if this transaction has a parent transaction
    - `created_at` (string) — Timestamp when the record was created _(example: `2026-01-14T00:01:02.180909`)_
    - `paid_at` (string)
    - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `source_data` (object)
      - `pan` (string) _(example: `0008`)_
      - `type` (string) _(example: `card`)_
      - `tenure` (string)
      - `sub_type` (string) _(example: `MasterCard`)_
    - `api_source` (string) _(example: `SUBSCRIPTION`)_
    - `is_void` (boolean)
    - `is_refund` (boolean)
    - `is_cashout` (boolean)
    - `data` (object)
      - `klass` (string) _(example: `MigsPayment`)_
      - `amount` (number) — Transaction amount in cents _(example: `20000`)_
      - `acs_eci` (string) — Electronic Commerce Indicator from 3D Secure
      - `message` (string) _(example: `Invalid card number`)_
      - `batch_no` (number) — Batch number for settlement _(example: `20260113`)_
      - `card_num` (string) — Masked card number _(example: `512345xxxxxx0008`)_
      - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
      - `merchant` (string) — Merchant information _(example: `TESTWE_ACEPTMOTO`)_
      - `card_type` (string) — Type of card (e.g., MASTERCARD, VISA) _(example: `MASTERCARD`)_
      - `created_at` (string) — Timestamp when the record was created _(example: `2026-01-13T22:01:05.330041`)_
      - `migs_order` (object)
        - `id` (string) — Unique identifier for the transaction _(example: `451338885`)_
        - `amount` (number) — Transaction amount in cents _(example: `200`)_
        - `status` (string) — Current status of the record _(example: `FAILED`)_
        - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
        - `reference` (string) _(example: `_397730312_451`)_
        - `chargeback` (object)
          - `amount` (number) — Transaction amount in cents
          - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
        - `description` (string) — Description of the item _(example: `PAYMOB Parmagly`)_
        - `creationTime` (string) _(example: `2026-01-13T22:00:54.090Z`)_
        - `merchantAmount` (number) _(example: `200`)_
        - `lastUpdatedTime` (string) _(example: `2026-01-13T22:01:05.081Z`)_
        - `merchantCurrency` (string) _(example: `EGP`)_
        - `acceptPartialAmount` (boolean)
        - `totalCapturedAmount` (number)
        - `totalRefundedAmount` (number)
        - `authenticationStatus` (string) _(example: `AUTHENTICATION_NOT_IN_EFFECT`)_
        - `merchantCategoryCode` (string) _(example: `6300`)_
        - `totalAuthorizedAmount` (number)
      - `order_info` (string) _(example: `451338885`)_
      - `receipt_no` (string) _(example: `601322152498`)_
      - `migs_result` (string) _(example: `FAILURE`)_
      - `secure_hash` (string) — Secure hash for transaction verification
      - `authorize_id` (string) — Authorization ID from the payment processor
      - `transaction_no` (string) — Transaction number from the payment processor
      - `avs_result_code` (string) — Address Verification System result code
      - `captured_amount` (number) — The amount that has been captured in cents
      - `refunded_amount` (number) — The amount that has been refunded in cents
      - `merchant_txn_ref` (string) _(example: `397730312`)_
      - `migs_transaction` (object)
        - `id` (string) — Unique identifier for the transaction _(example: `397730312`)_
        - `stan` (string) _(example: `152498`)_
        - `type` (string) _(example: `PAYMENT`)_
        - `amount` (number) — Transaction amount in cents _(example: `200`)_
        - `source` (string) _(example: `INTERNET`)_
        - `receipt` (string) _(example: `601322152498`)_
        - `acquirer` (object)
          - `id` (string) — Unique identifier for the transaction _(example: `BMNF_S2I`)_
          - `date` (string) _(example: `0113`)_
          - `batch` (number) _(example: `20260113`)_
          - `timeZone` (string) _(example: `+0200`)_
          - `merchantId` (string) _(example: `WE_ACEPTMOTO`)_
          - `settlementDate` (string) _(example: `2026-01-13`)_
        - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
        - `terminal` (string) _(example: `BQMS2I01`)_
        - `reference` (string) _(example: `_397730312`)_
        - `authenticationStatus` (string) _(example: `AUTHENTICATION_NOT_IN_EFFECT`)_
      - `acq_response_code` (string) _(example: `14`)_
      - `authorised_amount` (number) — The authorized amount in cents
      - `txn_response_code` (string) _(example: `DECLINED`)_
      - `avs_acq_response_code` (string) — AVS acquirer response code _(example: `14`)_
      - `gateway_integration_pk` (number) _(example: `2002433`)_
    - `is_hidden` (boolean) — Indicates if the transaction is hidden
    - `error_occured` (boolean) — Indicates if an error occurred during processing
    - `is_live` (boolean) — Indicates if this is a live (production) transaction
    - `other_endpoint_reference` (string) — Reference from external endpoint
    - `refunded_amount_cents` (number) — The amount that has been refunded in cents
    - `source_id` (number) — Source identifier _(example: `2046`)_
    - `is_captured` (boolean) — Indicates if the transaction has been captured
    - `captured_amount` (number) — The amount that has been captured in cents
    - `merchant_staff_tag` (string) — Staff tag for merchant tracking
    - `paymob_date` (string)
    - `value_date` (string)
    - `updated_at` (string) — Timestamp when the record was last updated _(example: `2026-01-14T00:01:07.764515`)_
    - `is_settled` (boolean) — Indicates if the transaction has been settled
    - `bill_balanced` (boolean) — Indicates if the bill is balanced
    - `is_bill` (boolean) — Indicates if this is a bill payment
    - `is_reconciled` (boolean)
    - `cogs` (number)
    - `reconciliation_id` (string)
    - `owner` (number) — Owner identifier _(example: `302852`)_
    - `order` (number) — Order details associated with this transaction _(example: `451338885`)_
    - `parent_transaction` (string) — Parent transaction ID

