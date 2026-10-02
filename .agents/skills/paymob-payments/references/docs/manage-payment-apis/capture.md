---
title: "Capture"
url: https://developers.paymob.com/paymob-docs/manage-payment-apis/capture
tab: developers
breadcrumbs: "Manage Payment APIs > Capture"
---

# Capture
**Outcome** \- Capture Auth transactions through API

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Refund%20%26%20Void%20%26%20Capture%20APIs%20Final.postman_collection).

### Authorization

Add your “**secret key** “ in the authorization header preceded by the word ”**Token** ”. 

> **Info:**
> 
> To know how to get your secret key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

* * *

#### Common errors

**Passing an amount greater than the transaction amount**

**Status Code** : 400 Bad Request

```json
{ 
    "detail": "Capture amount cannot exceed auth amount" 
}
``` 

**Solution** : The passed amount should be less than or equal to the transaction amount.

**Passing a not Auth transaction or a declined one**

**Status Code** : 404 Not Found

```json
{ 
    "detail": "Invalid transaction id" 
}
``` 

**Solution** : Make sure to pass a successful Auth transaction

* * *

## Endpoint

`POST api/acceptance/capture`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get your secret key from your Dashboard _(example: `Token sk_test_626xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Request body

- `transaction_id` (string) — **required** — The transaction ID you want to refund (Integer). _(example: `590482`)_
- `amount_cents` (string) — **required** — The amount will be refunded (Integer) _(example: `2000`)_

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `590506`)_
- `pending` (boolean) — Indicates whether the transaction is still pending
- `amount_cents` (number) — Transaction amount in cents _(example: `2000`)_
- `success` (boolean) — Indicates whether the transaction was successful _(example: `true`)_
- `is_auth` (boolean) — Indicates if this is an authorization transaction
- `is_capture` (boolean) — Indicates if this is a capture transaction _(example: `true`)_
- `is_standalone_payment` (boolean) — Indicates if this is a standalone payment
- `is_voided` (boolean) — Indicates if the transaction has been voided
- `is_refunded` (boolean) — Indicates if the transaction has been refunded
- `is_3d_secure` (boolean) — Indicates if 3D Secure authentication was used
- `integration_id` (number) — The integration ID used for this transaction _(example: `349`)_
- `profile_id` (number) — The merchant profile ID _(example: `106`)_
- `has_parent_transaction` (boolean) — Indicates if this transaction has a parent transaction _(example: `true`)_
- `order` (object) — Order details associated with this transaction
  - `id` (number) — Unique identifier for the transaction _(example: `710545`)_
  - `created_at` (string) — Timestamp when the record was created _(example: `2024-10-07T16:31:01.777969+04:00`)_
  - `delivery_needed` (boolean) — Indicates if delivery is required for this order
  - `merchant` (object) — Merchant information
    - `id` (number) — Unique identifier for the transaction _(example: `106`)_
    - `created_at` (string) — Timestamp when the record was created _(example: `2023-04-14T03:30:26.562808+04:00`)_
    - `phones` (array) — List of phone numbers
      - `0` (string) _(example: `10523456789`)_
    - `company_emails` (array) — List of company email addresses
      - `0` (string) _(example: `xxxxxxxx.03@gmail.com`)_
    - `company_name` (string) — The merchant company name _(example: `Retro`)_
    - `state` (string) — State or province
    - `country` (string) — Country name _(example: `xxxxx`)_
    - `city` (string) — City name _(example: `temp`)_
    - `postal_code` (string) — Postal or ZIP code
    - `street` (string) — Street address
  - `collector` (string)
  - `amount_cents` (number) — Transaction amount in cents _(example: `2000`)_
  - `shipping_data` (object) — Customer shipping information
    - `id` (number) — Unique identifier for the transaction _(example: `501690`)_
    - `first_name` (string) — Customer first name _(example: `ala`)_
    - `last_name` (string) — Customer last name _(example: `zain`)_
    - `street` (string) — Street address
    - `building` (string) — Building name or number
    - `floor` (string) — Floor number
    - `apartment` (string) — Apartment number
    - `city` (string) — City name
    - `state` (string) — State or province
    - `country` (string) — Country name
    - `email` (string) — Customer email address _(example: `xxxxxxx@gmail.com`)_
    - `phone_number` (string) — Customer phone number _(example: `+92345xxxxxxx`)_
    - `postal_code` (string) — Postal or ZIP code _(example: `NA`)_
    - `extra_description` (string)
    - `shipping_method` (string) _(example: `UNK`)_
    - `order_id` (number) — The unique order identifier _(example: `710545`)_
    - `order` (number) — Order details associated with this transaction _(example: `710545`)_
  - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
  - `is_payment_locked` (boolean)
  - `is_return` (boolean)
  - `is_cancel` (boolean)
  - `is_returned` (boolean)
  - `is_canceled` (boolean)
  - `merchant_order_id` (string) _(example: `phe4sjwxxxxxxxx3-121`)_
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
- `created_at` (string) — Timestamp when the record was created _(example: `2024-10-07T16:39:16.925065+04:00`)_
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
- `is_refund` (boolean)
- `data` (object)
  - `gateway_integration_pk` (number) _(example: `349`)_
  - `klass` (string) _(example: `MigsPayment`)_
  - `created_at` (string) — Timestamp when the record was created _(example: `2024-10-07T12:39:18.447293`)_
  - `amount` (number) — Transaction amount in cents _(example: `2000`)_
  - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
  - `migs_order` (object)
    - `amount` (number) — Transaction amount in cents _(example: `20`)_
    - `certainty` (string) _(example: `FINAL`)_
    - `chargeback` (object)
      - `amount` (number) — Transaction amount in cents
      - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `creationTime` (string) _(example: `2024-10-07T12:32:07.890Z`)_
    - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `id` (string) — Unique identifier for the transaction _(example: `710545`)_
    - `lastUpdatedTime` (string) _(example: `2024-10-07T12:39:18.283Z`)_
    - `merchantAmount` (number) _(example: `20`)_
    - `merchantCategoryCode` (string) _(example: `1234`)_
    - `merchantCurrency` (string) _(example: `EGP`)_
    - `status` (string) — Current status of the record _(example: `CAPTURED`)_
    - `totalAuthorizedAmount` (number) _(example: `20`)_
    - `totalCapturedAmount` (number) _(example: `20`)_
    - `totalDisbursedAmount` (number)
    - `totalRefundedAmount` (number)
  - `merchant` (string) — Merchant information _(example: `TEST10102022`)_
  - `migs_result` (string) _(example: `SUCCESS`)_
  - `migs_transaction` (object)
    - `acquirer` (object)
      - `batch` (number) _(example: `20241007`)_
      - `date` (string) _(example: `1007`)_
      - `id` (string) — Unique identifier for the transaction _(example: `xxxxx_S2I`)_
      - `merchantId` (string) _(example: `10102022`)_
      - `settlementDate` (string) _(example: `2024-10-07`)_
      - `timeZone` (string) _(example: `+0400`)_
      - `transactionId` (string) _(example: `123456789`)_
    - `amount` (number) — Transaction amount in cents _(example: `20`)_
    - `authorizationCode` (string) _(example: `067863`)_
    - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `id` (string) — Unique identifier for the transaction _(example: `590506`)_
    - `receipt` (string) _(example: `428112067863`)_
    - `source` (string) _(example: `INTERNET`)_
    - `stan` (string) _(example: `68893`)_
    - `terminal` (string) _(example: `MASS2I05`)_
    - `type` (string) _(example: `CAPTURE`)_
  - `txn_response_code` (string) _(example: `APPROVED`)_
  - `acq_response_code` (string) _(example: `00`)_
  - `message` (string) _(example: `Approved`)_
  - `merchant_txn_ref` (string) _(example: `590506`)_
  - `order_info` (string) _(example: `710545`)_
  - `receipt_no` (string) _(example: `428112067863`)_
  - `transaction_no` (string) — Transaction number from the payment processor _(example: `123456789`)_
  - `batch_no` (number) — Batch number for settlement _(example: `20241007`)_
  - `authorize_id` (string) — Authorization ID from the payment processor _(example: `067863`)_
  - `card_type` (string) — Type of card (e.g., MASTERCARD, VISA) _(example: `MASTERCARD`)_
  - `card_num` (string) — Masked card number _(example: `512345xxxxxx2346`)_
  - `secure_hash` (string) — Secure hash for transaction verification
  - `avs_result_code` (string) — Address Verification System result code
  - `avs_acq_response_code` (string) — AVS acquirer response code _(example: `00`)_
  - `captured_amount` (number) — The amount that has been captured in cents _(example: `20`)_
  - `authorised_amount` (number) — The authorized amount in cents _(example: `20`)_
  - `refunded_amount` (number) — The amount that has been refunded in cents
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
- `updated_at` (string) — Timestamp when the record was last updated _(example: `2024-10-07T16:39:18.456998+04:00`)_
- `is_settled` (boolean) — Indicates if the transaction has been settled
- `bill_balanced` (boolean) — Indicates if the bill is balanced
- `is_bill` (boolean) — Indicates if this is a bill payment
- `owner` (number) — Owner identifier _(example: `211`)_
- `parent_transaction` (number) — Parent transaction ID _(example: `590482`)_

