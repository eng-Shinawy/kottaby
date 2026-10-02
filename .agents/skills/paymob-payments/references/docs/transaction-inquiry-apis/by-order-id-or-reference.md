---
title: "By Order ID or Reference"
url: https://developers.paymob.com/paymob-docs/transaction-inquiry-apis/by-order-id-or-reference
tab: developers
breadcrumbs: "Transaction Inquiry APIs > By Order ID or Reference"
---

# By Order ID or Reference
**Outcome** \- Retrieve the last transaction details by the Order ID or the Merchant Order ID

* * *

You can retrieve the last transaction related to an order ID or a Merchant Order ID (Which you sent while [**creating and Intention**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention) as a `**special_reference**`)

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Transaction%20Inquiry%20API%20Final.postman_collection).

> **Info:**
> 
> You can get a valid auth token by [**Authentication Request (Generate Auth Token)**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1)

* * *

## Endpoint

`POST api/ecommerce/orders/transaction_inquiry`

**Content-Type:** `application/json`

### Request body

- `auth_token` (string) — **required** — You can get a valid auth token by [Authentication Request ](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token). _(example: `ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `order_id` (string) — The order ID you want to retrieve the last transaction ID related to it. _(example: `212245716`)_
- `merchant_order_id` (string) — The Merchant Order ID you want to retrieve the last transaction ID related to it. It's not a required field.

### Response 200

- `id` (number) _(example: `187200498`)_
- `pending` (boolean) _(example: `true`)_
- `amount_cents` (number) _(example: `100000`)_
- `success` (boolean) _(example: `false`)_
- `is_auth` (boolean) _(example: `false`)_
- `is_capture` (boolean) _(example: `false`)_
- `is_standalone_payment` (boolean) _(example: `true`)_
- `is_voided` (boolean) _(example: `false`)_
- `is_refunded` (boolean) _(example: `false`)_
- `is_3d_secure` (boolean) _(example: `false`)_
- `integration_id` (number) _(example: `1994494`)_
- `profile_id` (number) _(example: `164295`)_
- `has_parent_transaction` (boolean) _(example: `false`)_
- `order` (object)
  - `id` (number) _(example: `212245716`)_
  - `created_at` (string) _(example: `2024-05-26T12:37:24.464153`)_
  - `delivery_needed` (boolean) _(example: `false`)_
  - `merchant` (object)
    - `id` (number) _(example: `164295`)_
    - `created_at` (string) _(example: `2022-03-24T20:13:47.852384`)_
    - `phones` (array)
      - `0` (string) _(example: `+201024710769`)_
      - `1` (string) _(example: `+201010101010`)_
    - `company_emails` (array)
      - `0` (string) _(example: `mohamedabdelsttar97@gmail.com`)_
      - `1` (string) _(example: `test@test.com`)_
    - `company_name` (string) _(example: `Parmagly`)_
    - `state` (string)
    - `country` (string) _(example: `EGY`)_
    - `city` (string) _(example: `Cairo`)_
    - `postal_code` (string)
    - `street` (string)
  - `collector` (string)
  - `amount_cents` (number) _(example: `100000`)_
  - `shipping_data` (object)
    - `id` (number) _(example: `105331974`)_
    - `first_name` (string) _(example: `MMMM`)_
    - `last_name` (string) _(example: `AAAA`)_
    - `street` (string) _(example: `NA`)_
    - `building` (string) _(example: `NA`)_
    - `floor` (string) _(example: `NA`)_
    - `apartment` (string) _(example: `NA`)_
    - `city` (string) _(example: `NA`)_
    - `state` (string) _(example: `NA`)_
    - `country` (string) _(example: `NA`)_
    - `email` (string) _(example: `msttar@teml.net`)_
    - `phone_number` (string) _(example: `+201010101010`)_
    - `postal_code` (string) _(example: `NA`)_
    - `extra_description` (string)
    - `shipping_method` (string) _(example: `UNK`)_
    - `order_id` (number) _(example: `212245716`)_
    - `order` (number) _(example: `212245716`)_
  - `currency` (string) _(example: `EGP`)_
  - `is_payment_locked` (boolean) _(example: `false`)_
  - `is_return` (boolean) _(example: `false`)_
  - `is_cancel` (boolean) _(example: `false`)_
  - `is_returned` (boolean) _(example: `false`)_
  - `is_canceled` (boolean) _(example: `false`)_
  - `merchant_order_id` (string)
  - `wallet_notification` (string)
  - `paid_amount_cents` (number) _(example: `0`)_
  - `notify_user_with_email` (boolean) _(example: `false`)_
  - `items` (array)
  - `order_url` (string) _(example: `https://accept.paymobsolutions.com/flash/?type=new&token=LRR2ZlUwNFJ5TGFrbXV4Y1FER0RBY0VZdz09X2F1ODJNbXFUUDFxc2ZYRHFv...`)_
  - `commission_fees` (number) _(example: `0`)_
  - `delivery_fees_cents` (number) _(example: `0`)_
  - `delivery_vat_cents` (number) _(example: `0`)_
  - `payment_method` (string) _(example: `tbc`)_
  - `merchant_staff_tag` (string)
  - `api_source` (string) _(example: `QUICKLINK`)_
  - `data` (object)
  - `payment_status` (string) _(example: `UNPAID`)_
  - `terminal_version` (string)
- `created_at` (string) _(example: `2024-05-26T12:38:16.978680`)_
- `transaction_processed_callback_responses` (array)
- `currency` (string) _(example: `EGP`)_
- `source_data` (object)
  - `pan` (string)
  - `type` (string) _(example: `aggregator`)_
  - `sub_type` (string) _(example: `AGGREGATOR`)_
- `api_source` (string) _(example: `QUICKLINK`)_
- `terminal_id` (string)
- `merchant_commission` (number) _(example: `0`)_
- `accept_fees` (number) _(example: `0`)_
- `installment` (string)
- `discount_details` (array)
- `is_void` (boolean) _(example: `false`)_
- `is_refund` (boolean) _(example: `false`)_
- `data` (object)
  - `otp` (string)
  - `ref` (string)
  - `rrn` (string)
  - `klass` (string) _(example: `CAGGPayment`)_
  - `amount` (string)
  - `biller` (string)
  - `message` (string) _(example: `Pending Payment`)_
  - `from_user` (string)
  - `due_amount` (number) _(example: `100000`)_
  - `agg_terminal` (string)
  - `paid_through` (string)
  - `bill_reference` (number) _(example: `187200498`)_
  - `cashout_amount` (string)
  - `txn_response_code` (string) _(example: `05`)_
  - `gateway_integration_pk` (number) _(example: `1994494`)_
- `is_hidden` (boolean) _(example: `false`)_
- `payment_key_claims` (object)
  - `exp` (number) _(example: `1716719891`)_
  - `extra` (object)
  - `user_id` (number) _(example: `302852`)_
  - `currency` (string) _(example: `EGP`)_
  - `order_id` (number) _(example: `212245716`)_
  - `amount_cents` (number) _(example: `100000`)_
  - `billing_data` (object)
    - `city` (string) _(example: `NA`)_
    - `email` (string) _(example: `msttar@teml.net`)_
    - `floor` (string) _(example: `NA`)_
    - `state` (string) _(example: `NA`)_
    - `street` (string) _(example: `NA`)_
    - `country` (string) _(example: `NA`)_
    - `building` (string) _(example: `NA`)_
    - `apartment` (string) _(example: `NA`)_
    - `last_name` (string) _(example: `AAAA`)_
    - `first_name` (string) _(example: `MMMM`)_
    - `postal_code` (string) _(example: `NA`)_
    - `phone_number` (string) _(example: `+201010101010`)_
    - `extra_description` (string) _(example: `NA`)_
  - `integration_id` (number) _(example: `1994494`)_
  - `lock_order_when_paid` (boolean) _(example: `false`)_
  - `next_payment_intention` (string) _(example: `pi_test_2789145ffcd14993a7f72dd4c35f759e`)_
  - `single_payment_attempt` (boolean) _(example: `false`)_
- `error_occured` (boolean) _(example: `false`)_
- `is_live` (boolean) _(example: `false`)_
- `other_endpoint_reference` (string)
- `refunded_amount_cents` (number) _(example: `0`)_
- `source_id` (number) _(example: `-1`)_
- `is_captured` (boolean) _(example: `false`)_
- `captured_amount` (number) _(example: `0`)_
- `merchant_staff_tag` (string)
- `updated_at` (string) _(example: `2024-05-26T12:38:17.384261`)_
- `is_settled` (boolean) _(example: `false`)_
- `bill_balanced` (boolean) _(example: `false`)_
- `is_bill` (boolean) _(example: `false`)_
- `owner` (number) _(example: `302852`)_
- `parent_transaction` (string)
- `unique_ref` (string) _(example: `1994494_10a8ac8ac1095cee87387997b70cdd97`)_

