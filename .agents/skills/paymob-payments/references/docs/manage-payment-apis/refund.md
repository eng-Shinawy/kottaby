---
title: "Refund"
url: https://developers.paymob.com/paymob-docs/manage-payment-apis/refund
tab: developers
breadcrumbs: "Manage Payment APIs > Refund"
---

# Refund
**Outcome** \- Refund transactions through API

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Refund%20%26%20Void%20%26%20Capture%20APIs%20Final.postman_collection).

### Authorization

Add your “**secret key** “ in the authorization header preceded by the word ”**Token** ”. 

> **Info:**
> 
> To know how to get your secret key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

> **Warning:**
> 
> **Note!**
> 
> Upon processing a refund transaction, you will receive callbacks for the parent transaction associated with it. These callbacks will include the flag,`"is_refunded": true` indicating that the transaction has been refunded. You can find the ID of the parent transaction in the `"parent_transaction"` key within the callbacks of the refund transaction.

* * *

#### Common errors

**Passing an amount greater than the transaction amount**

**Status Code** : 400 Bad Request

```json
{ 
    "message": "Requested Refund Amount is greater than the maximum refund amount permissible. Maximum Refund Amount is EGP 100.0" 
}
``` 

**Solution** : The passed amount should be less than or equal to the transaction amount.

* * *

## Endpoint

`POST api/acceptance/void_refund/refund`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get your secret key from your Dashboard _(example: `Token sk_test_626xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Request body

- `transaction_id` (string) — **required** — The transaction ID you want to refund (Integer). _(example: `574588`)_
- `amount_cents` (string) — **required** — The amount will be refunded (Integer) _(example: `1000`)_

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `579305`)_
- `pending` (boolean) — Indicates whether the transaction is still pending
- `amount_cents` (number) — Transaction amount in cents _(example: `1000`)_
- `success` (boolean) — Indicates whether the transaction was successful _(example: `true`)_
- `is_auth` (boolean) — Indicates if this is an authorization transaction
- `is_capture` (boolean) — Indicates if this is a capture transaction
- `is_standalone_payment` (boolean) — Indicates if this is a standalone payment
- `is_voided` (boolean) — Indicates if the transaction has been voided
- `is_refunded` (boolean) — Indicates if the transaction has been refunded
- `is_3d_secure` (boolean) — Indicates if 3D Secure authentication was used
- `integration_id` (number) — The integration ID used for this transaction _(example: `158`)_
- `profile_id` (number) — The merchant profile ID _(example: `106`)_
- `has_parent_transaction` (boolean) — Indicates if this transaction has a parent transaction _(example: `true`)_
- `order` (object) — Order details associated with this transaction
  - `id` (number) — Unique identifier for the transaction _(example: `690898`)_
  - `created_at` (string) — Timestamp when the record was created _(example: `2024-10-02T16:31:23.273982+04:00`)_
  - `delivery_needed` (boolean) — Indicates if delivery is required for this order
  - `merchant` (object) — Merchant information
    - `id` (number) — Unique identifier for the transaction _(example: `106`)_
    - `created_at` (string) — Timestamp when the record was created _(example: `2023-04-14T03:30:26.562808+04:00`)_
    - `phones` (array) — List of phone numbers
      - `0` (string) _(example: `105xxxxxxxxxxxxx`)_
    - `company_emails` (array) — List of company email addresses
      - `0` (string) _(example: `xxxxxx.03@gmail.com`)_
    - `company_name` (string) — The merchant company name _(example: `Retro`)_
    - `state` (string) — State or province
    - `country` (string) — Country name _(example: `xxx`)_
    - `city` (string) — City name _(example: `temp`)_
    - `postal_code` (string) — Postal or ZIP code
    - `street` (string) — Street address
  - `collector` (string)
  - `amount_cents` (number) — Transaction amount in cents _(example: `2000`)_
  - `shipping_data` (object) — Customer shipping information
    - `id` (number) — Unique identifier for the transaction _(example: `488035`)_
    - `first_name` (string) — Customer first name _(example: `ala`)_
    - `last_name` (string) — Customer last name _(example: `zain`)_
    - `street` (string) — Street address
    - `building` (string) — Building name or number
    - `floor` (string) — Floor number
    - `apartment` (string) — Apartment number
    - `city` (string) — City name
    - `state` (string) — State or province
    - `country` (string) — Country name
    - `email` (string) — Customer email address _(example: `ali@gmail.com`)_
    - `phone_number` (string) — Customer phone number _(example: `+923459989111`)_
    - `postal_code` (string) — Postal or ZIP code _(example: `NA`)_
    - `extra_description` (string)
    - `shipping_method` (string) _(example: `UNK`)_
    - `order_id` (number) — The unique order identifier _(example: `690898`)_
    - `order` (number) — Order details associated with this transaction _(example: `690898`)_
  - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
  - `is_payment_locked` (boolean)
  - `is_return` (boolean)
  - `is_cancel` (boolean)
  - `is_returned` (boolean)
  - `is_canceled` (boolean)
  - `merchant_order_id` (string) _(example: `phe4sjw11q-11212-221`)_
  - `wallet_notification` (string)
  - `paid_amount_cents` (number) _(example: `2000`)_
  - `notify_user_with_email` (boolean)
  - `items` (array) — List of items in the order
    - `0` (array) — List of items in the order
      - `name` (string) — Name of the item _(example: `Item name`)_
      - `description` (string) — Description of the item _(example: `Item description`)_
      - `amount_cents` (number) — Transaction amount in cents _(example: `2000`)_
      - `quantity` (number) — Quantity of items _(example: `1`)_
  - `order_url` (string) _(example: `NA`)_
  - `commission_fees` (number)
  - `delivery_fees_cents` (number)
  - `delivery_vat_cents` (number)
  - `payment_method` (string) _(example: `tbc`)_
  - `merchant_staff_tag` (string) — Staff tag for merchant tracking
  - `api_source` (string) _(example: `OTHER`)_
  - `data` (object)
- `created_at` (string) — Timestamp when the record was created _(example: `2024-10-03T21:03:33.057183+04:00`)_
- `transaction_processed_callback_responses` (array)
- `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
- `source_data` (object)
  - `type` (string) _(example: `card`)_
  - `pan` (string) _(example: `2346`)_
  - `sub_type` (string) _(example: `MasterCard`)_
  - `tenure` (string)
- `api_source` (string) _(example: `OTHER`)_
- `terminal_id` (string)
- `merchant_commission` (number)
- `installment` (string)
- `discount_details` (array)
- `is_void` (boolean)
- `is_refund` (boolean) _(example: `true`)_
- `data` (object)
  - `gateway_integration_pk` (number) _(example: `158`)_
  - `klass` (string) _(example: `MigsPayment`)_
  - `created_at` (string) — Timestamp when the record was created _(example: `2024-10-03T17:03:34.533231`)_
  - `amount` (number) — Transaction amount in cents _(example: `1000`)_
  - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
  - `migs_order` (object)
    - `amount` (number) — Transaction amount in cents _(example: `20`)_
    - `chargeback` (object)
      - `amount` (number) — Transaction amount in cents
      - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `creationTime` (string) _(example: `2024-10-02T12:33:48.655Z`)_
    - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `id` (string) — Unique identifier for the transaction _(example: `690898`)_
    - `lastUpdatedTime` (string) _(example: `2024-10-03T17:03:34.362Z`)_
    - `merchantAmount` (number) _(example: `20`)_
    - `merchantCategoryCode` (string) _(example: `1234`)_
    - `merchantCurrency` (string) _(example: `EGP`)_
    - `status` (string) — Current status of the record _(example: `REFUNDED`)_
    - `totalAuthorizedAmount` (number) _(example: `20`)_
    - `totalCapturedAmount` (number) _(example: `20`)_
    - `totalDisbursedAmount` (number)
    - `totalRefundedAmount` (number) _(example: `20`)_
  - `merchant` (string) — Merchant information _(example: `TEST10102022`)_
  - `migs_result` (string) _(example: `SUCCESS`)_
  - `migs_transaction` (object)
    - `acquirer` (object)
      - `batch` (number) _(example: `20241003`)_
      - `date` (string) _(example: `1003`)_
      - `id` (string) — Unique identifier for the transaction _(example: `MASHREQ_S2I`)_
      - `merchantId` (string) _(example: `10102022`)_
      - `settlementDate` (string) _(example: `2024-10-03`)_
      - `timeZone` (string) _(example: `+0400`)_
      - `transactionId` (string) _(example: `123456789`)_
    - `amount` (number) — Transaction amount in cents _(example: `10`)_
    - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `id` (string) — Unique identifier for the transaction _(example: `579305`)_
    - `receipt` (string) _(example: `427717001085`)_
    - `source` (string) _(example: `INTERNET`)_
    - `stan` (string) _(example: `1085`)_
    - `terminal` (string) _(example: `MASS2I05`)_
    - `type` (string) _(example: `REFUND`)_
  - `txn_response_code` (string) _(example: `APPROVED`)_
  - `acq_response_code` (string) _(example: `00`)_
  - `message` (string) _(example: `Approved`)_
  - `merchant_txn_ref` (string) _(example: `579305`)_
  - `order_info` (string) _(example: `690898`)_
  - `receipt_no` (string) _(example: `427717001085`)_
  - `transaction_no` (string) — Transaction number from the payment processor _(example: `123456789`)_
  - `batch_no` (number) — Batch number for settlement _(example: `20241003`)_
  - `authorize_id` (string) — Authorization ID from the payment processor
  - `card_type` (string) — Type of card (e.g., MASTERCARD, VISA) _(example: `MASTERCARD`)_
  - `card_num` (string) — Masked card number _(example: `512345xxxxxx2346`)_
  - `secure_hash` (string) — Secure hash for transaction verification
  - `avs_result_code` (string) — Address Verification System result code
  - `avs_acq_response_code` (string) — AVS acquirer response code _(example: `00`)_
  - `captured_amount` (number) — The amount that has been captured in cents _(example: `20`)_
  - `authorised_amount` (number) — The authorized amount in cents _(example: `20`)_
  - `refunded_amount` (number) — The amount that has been refunded in cents _(example: `20`)_
  - `acs_eci` (string) — Electronic Commerce Indicator from 3D Secure
- `is_hidden` (boolean) — Indicates if the transaction is hidden
- `payment_key_claims` (string) — Payment key claims data
- `error_occured` (boolean) — Indicates if an error occurred during processing
- `is_live` (boolean) — Indicates if this is a live (production) transaction
- `other_endpoint_reference` (string) — Reference from external endpoint
- `refunded_amount_cents` (number) — The amount that has been refunded in cents
- `source_id` (number) — Source identifier _(example: `-1`)_
- `is_captured` (boolean) — Indicates if the transaction has been captured
- `captured_amount` (number) — The amount that has been captured in cents
- `merchant_staff_tag` (string) — Staff tag for merchant tracking
- `updated_at` (string) — Timestamp when the record was last updated _(example: `2024-10-03T21:03:34.541820+04:00`)_
- `is_settled` (boolean) — Indicates if the transaction has been settled
- `bill_balanced` (boolean) — Indicates if the bill is balanced
- `is_bill` (boolean) — Indicates if this is a bill payment
- `owner` (number) — Owner identifier _(example: `211`)_
- `parent_transaction` (number) — Parent transaction ID _(example: `574588`)_

