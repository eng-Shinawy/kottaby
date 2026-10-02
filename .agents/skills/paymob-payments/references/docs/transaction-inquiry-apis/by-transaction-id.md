---
title: "By Transaction ID"
url: https://developers.paymob.com/paymob-docs/transaction-inquiry-apis/by-transaction-id
tab: developers
breadcrumbs: "Transaction Inquiry APIs > By Transaction ID"
---

# By Transaction ID
**Outcome** \- Retrieve transaction details by transaction ID

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Transaction%20Inquiry%20API%20Final.postman_collection).

### **Authorization**

You should send a valid auth token as a Bearer Token. 

> **Info:**
> 
> You can get a valid auth token by [**Authentication Request (Generate Auth Token)**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1)

* * *

## Endpoint

`GET api/acceptance/transactions/{transaction_id}`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (String) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `transaction_id` (String) — The transaction ID you want to retrieve the details for. _(example: `130837277`)_

### Response 200

- `id` (number) _(example: `130837277`)_
- `pending` (boolean) _(example: `false`)_
- `amount_cents` (number) _(example: `700000`)_
- `success` (boolean) _(example: `true`)_
- `is_auth` (boolean) _(example: `false`)_
- `is_capture` (boolean) _(example: `false`)_
- `is_standalone_payment` (boolean) _(example: `true`)_
- `is_voided` (boolean) _(example: `false`)_
- `is_refunded` (boolean) _(example: `false`)_
- `is_3d_secure` (boolean) _(example: `false`)_
- `integration_id` (number) _(example: `1994575`)_
- `terminal_id` (string)
- `has_parent_transaction` (boolean) _(example: `false`)_
- `order` (object)
  - `id` (number) _(example: `149113131`)_
  - `created_at` (string) _(example: `2023-09-07T22:15:18.073610`)_
  - `delivery_needed` (boolean) _(example: `false`)_
  - `merchant` (object)
    - `id` (number) _(example: `164295`)_
    - `created_at` (string) _(example: `2022-03-24T20:13:47.852384`)_
    - `phones` (array)
      - `0` (string) _(example: `+201010101011`)_
      - `1` (string) _(example: `+201010101010`)_
    - `company_emails` (array)
      - `0` (string) _(example: `test2@test.com`)_
      - `1` (string) _(example: `test@test.com`)_
    - `company_name` (string) _(example: `Parmagly`)_
    - `state` (string)
    - `country` (string) _(example: `EGY`)_
    - `city` (string) _(example: `Cairo`)_
    - `postal_code` (string)
    - `street` (string)
  - `collector` (string)
  - `amount_cents` (number) _(example: `700000`)_
  - `shipping_data` (object)
    - `id` (number) _(example: `73302781`)_
    - `first_name` (string) _(example: `Clifford`)_
    - `last_name` (string) _(example: `Nicolas`)_
    - `street` (string) _(example: `Ethan Land`)_
    - `building` (string) _(example: `8028`)_
    - `floor` (string) _(example: `42`)_
    - `apartment` (string) _(example: `803`)_
    - `city` (string) _(example: `Jaskolskiburgh`)_
    - `state` (string) _(example: `Utah`)_
    - `country` (string) _(example: `CR`)_
    - `email` (string) _(example: `claudette09@exa.com`)_
    - `phone_number` (string) _(example: `+86(8)9135210487`)_
    - `postal_code` (string) _(example: `01898`)_
    - `extra_description` (string) _(example: `8 Ram , 128 Giga`)_
    - `shipping_method` (string) _(example: `UNK`)_
    - `order_id` (number) _(example: `149113131`)_
    - `order` (number) _(example: `149113131`)_
  - `currency` (string) _(example: `EGP`)_
  - `is_payment_locked` (boolean) _(example: `false`)_
  - `is_return` (boolean) _(example: `false`)_
  - `is_cancel` (boolean) _(example: `false`)_
  - `is_returned` (boolean) _(example: `false`)_
  - `is_canceled` (boolean) _(example: `false`)_
  - `merchant_order_id` (string)
  - `wallet_notification` (string)
  - `paid_amount_cents` (number) _(example: `700000`)_
  - `notify_user_with_email` (boolean) _(example: `false`)_
  - `items` (array)
  - `order_url` (string) _(example: `https://accept.paymob.com/standalone/?ref=i_LRR2Q0FtbGdxV0lzNmJuNzNHVWY2S2ppdz09X1dmdllncEFjeFl4Vlh0N0lzVy80a0E9PQ`)_
  - `commission_fees` (number) _(example: `0`)_
  - `delivery_fees_cents` (number) _(example: `0`)_
  - `delivery_vat_cents` (number) _(example: `0`)_
  - `payment_method` (string) _(example: `tbc`)_
  - `merchant_staff_tag` (string)
  - `api_source` (string) _(example: `OTHER`)_
  - `data` (object)
  - `payment_status` (string) _(example: `PAID`)_
  - `terminal_version` (string)
- `created_at` (string) _(example: `2023-09-07T22:16:48.788383`)_
- `paid_at` (string) _(example: `2023-09-07T22:16:55.120292`)_
- `currency` (string) _(example: `EGP`)_
- `source_data` (object)
  - `pan` (string) _(example: `01010101010`)_
  - `type` (string) _(example: `valu`)_
  - `tenure` (number) _(example: `9`)_
  - `sub_type` (string) _(example: `valu`)_
  - `down_payment` (number) _(example: `0`)_
  - `customer_code` (string) _(example: `01010101010`)_
  - `cashback_amount` (number) _(example: `0`)_
  - `gift_card_amount` (number) _(example: `0`)_
- `api_source` (string) _(example: `IFRAME`)_
- `fees` (string) _(example: `N/A`)_
- `vat` (string) _(example: `N/A`)_
- `converted_gross_amount` (string) _(example: `N/A`)_
- `is_cashout` (boolean) _(example: `false`)_
- `wallet_transaction_type` (string)
- `is_upg` (boolean) _(example: `false`)_
- `is_internal_refund` (boolean) _(example: `false`)_
- `billing_data` (object)
  - `id` (number) _(example: `96020734`)_
  - `first_name` (string) _(example: `Clifford`)_
  - `last_name` (string) _(example: `Nicolas`)_
  - `street` (string) _(example: `Ethan Land`)_
  - `building` (string) _(example: `8028`)_
  - `floor` (string) _(example: `42`)_
  - `apartment` (string) _(example: `803`)_
  - `city` (string) _(example: `Jaskolskiburgh`)_
  - `state` (string) _(example: `Utah`)_
  - `country` (string) _(example: `CR`)_
  - `email` (string) _(example: `claudette09@exa.com`)_
  - `phone_number` (string) _(example: `+86(8)9135210487`)_
  - `postal_code` (string) _(example: `01898`)_
  - `ip_address` (string)
  - `extra_description` (string) _(example: `NA`)_
  - `transaction_id` (number) _(example: `130837277`)_
  - `created_at` (string) _(example: `2023-09-07T22:16:48.810638`)_
- `installment` (string)
- `integration_type` (string) _(example: `valu_online`)_
- `card_type` (string) _(example: `valu`)_
- `routing_bank` (string) _(example: `-`)_
- `card_holder_bank` (string) _(example: `-`)_
- `merchant_commission` (number) _(example: `0`)_
- `accept_fees` (number) _(example: `0`)_
- `extra_detail` (string)
- `discount_details` (array)
- `caf_details` (array)
- `show_caf_in_receipt` (string)
- `pre_conversion_currency` (string)
- `pre_conversion_amount_cents` (string)
- `is_host2host` (boolean) _(example: `false`)_
- `installment_info` (object)
  - `items` (array)
  - `administrative_fees` (number) _(example: `0`)_
  - `down_payment` (number) _(example: `0`)_
  - `tenure` (string) _(example: `9`)_
  - `finance_amount` (number) _(example: `7000`)_
  - `discount_amount` (number) _(example: `0`)_
  - `cashback_amount` (number) _(example: `0`)_
  - `gift_card_amount` (number) _(example: `0`)_
- `vf_loyalty_details` (object)
- `purchase_fees` (number) _(example: `0`)_
- `original_amount` (number) _(example: `700000`)_
- `is_trx_bank_installment` (boolean) _(example: `false`)_
- `payment_source` (string)
- `split_description` (array)
- `is_split_payment` (boolean) _(example: `false`)_
- `allow_cardless_refund` (boolean) _(example: `false`)_
- `is_void` (boolean) _(example: `false`)_
- `is_refund` (boolean) _(example: `false`)_
- `data` (object)
  - `emi` (string) _(example: `123`)_
  - `date` (string) _(example: `2023-09-07`)_
  - `klass` (string) _(example: `ValuPayment`)_
  - `amount` (number) _(example: `700000`)_
  - `tenure` (string) _(example: `9`)_
  - `address` (string) _(example: `Mostafa Al nahaas, Nasr City Cairo`)_
  - `message` (string) _(example: `Your transaction worth EGP 7000.0 is now successfully processed and your monthly installment amount over 9 month is E...`)_
  - `currency` (string) _(example: `EGP`)_
  - `full_name` (string) _(example: `Mostafa El Mohamady`)_
  - `created_at` (string) _(example: `2023-09-07T19:16:49.024271`)_
  - `national_id` (string) _(example: `27903040505771`)_
  - `receipt_url` (string) _(example: `https://accept.paymobsolutions.com/api/acceptance/valu_contract?token=ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o...`)_
  - `tenure_list` (array)
    - `0` (string) _(example: `3`)_
    - `1` (string) _(example: `6`)_
    - `2` (string) _(example: `9`)_
    - `3` (string) _(example: `12`)_
    - `4` (string) _(example: `15`)_
    - `5` (string) _(example: `18`)_
    - `6` (string) _(example: `21`)_
    - `7` (string) _(example: `24`)_
  - `down_payment` (string) _(example: `0.0`)_
  - `message_code` (string) _(example: `1`)_
  - `message_type` (string) _(example: `CF`)_
  - `customer_code` (string) _(example: `01010101010`)_
  - `purchase_fees` (string) _(example: `0.0`)_
  - `transaction_id` (string) _(example: `130837277149113131`)_
  - `original_amount` (number) _(example: `700000`)_
  - `txn_response_code` (string) _(example: `101`)_
  - `product_ref_number` (string) _(example: `CL121118123434`)_
  - `purchase_error_code` (string) _(example: `101`)_
  - `purchase_error_type` (string) _(example: `TS`)_
  - `purchase_ref_number` (string) _(example: `130837277149113131`)_
  - `amount_without_giftcard` (number) _(example: `700000`)_
- `is_hidden` (boolean) _(example: `false`)_
- `error_occured` (boolean) _(example: `false`)_
- `is_live` (boolean) _(example: `false`)_
- `other_endpoint_reference` (string) _(example: `130837277149113131`)_
- `refunded_amount_cents` (number) _(example: `0`)_
- `source_id` (number) _(example: `-1`)_
- `is_captured` (boolean) _(example: `false`)_
- `captured_amount` (number) _(example: `0`)_
- `merchant_staff_tag` (string)
- `paymob_date` (string)
- `value_date` (string)
- `updated_at` (string) _(example: `2023-09-07T22:16:55.560378`)_
- `is_settled` (boolean) _(example: `false`)_
- `bill_balanced` (boolean) _(example: `false`)_
- `is_bill` (boolean) _(example: `false`)_
- `is_reconciled` (boolean) _(example: `false`)_
- `cogs` (number) _(example: `0`)_
- `reconciliation_id` (string)
- `owner` (number) _(example: `302852`)_
- `parent_transaction` (string)

