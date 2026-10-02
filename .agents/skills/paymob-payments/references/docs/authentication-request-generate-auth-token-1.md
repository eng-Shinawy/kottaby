---
title: "Authentication Request (Generate Auth Token)"
url: https://developers.paymob.com/paymob-docs/authentication-request-generate-auth-token-1
tab: developers
breadcrumbs: "Authentication Request (Generate Auth Token)"
---

# Authentication Request (Generate Auth Token)
**Outcome** \- Generate an Auth token to use for authentication across multiple API endpoints (e.g., Subscription APIs, create QuickLink).

* * *

You'll need to pass your **API Key** in the body of the request.

> **Info:**
> 
> To know how to get your API key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

* * *

## Endpoint

`POST api/auth/tokens`

**Content-Type:** `application/json`

### Request body

- `api_key` (string) — **required** _(example: `ZXlKaGJHY2lPaUpJVXpVexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Response 200

- `profile` (object)
  - `id` (number) _(example: `106`)_
  - `user` (object)
    - `id` (number) _(example: `211`)_
    - `username` (string) _(example: `5xxxxxxx`)_
    - `first_name` (string) _(example: `Amxxxxx`)_
    - `last_name` (string) _(example: `Asxxxxxx`)_
    - `date_joined` (string) _(example: `2023-04-14T03:30:26+04:00`)_
    - `email` (string) _(example: `axxxxxxxxxxxxxxxxxx.03@gmail.com`)_
    - `is_active` (boolean) _(example: `true`)_
    - `is_staff` (boolean) _(example: `false`)_
    - `is_superuser` (boolean) _(example: `false`)_
    - `last_login` (string)
    - `groups` (array)
    - `user_permissions` (array)
      - `0` (number) _(example: `875`)_
      - `1` (number) _(example: `861`)_
      - `2` (number) _(example: `869`)_
      - `3` (number) _(example: `850`)_
      - `4` (number) _(example: `880`)_
      - `5` (number) _(example: `862`)_
      - `6` (number) _(example: `876`)_
      - `7` (number) _(example: `865`)_
      - `8` (number) _(example: `884`)_
      - `9` (number) _(example: `855`)_
      - `10` (number) _(example: `872`)_
      - `11` (number) _(example: `854`)_
      - `12` (number) _(example: `877`)_
      - `13` (number) _(example: `867`)_
      - `14` (number) _(example: `887`)_
      - `15` (number) _(example: `859`)_
      - `16` (number) _(example: `902`)_
      - `17` (number) _(example: `901`)_
      - `18` (number) _(example: `860`)_
      - `19` (number) _(example: `893`)_
      - `20` (number) _(example: `883`)_
      - `21` (number) _(example: `871`)_
      - `22` (number) _(example: `882`)_
      - `23` (number) _(example: `851`)_
      - `24` (number) _(example: `863`)_
      - `25` (number) _(example: `879`)_
      - `26` (number) _(example: `866`)_
      - `27` (number) _(example: `885`)_
      - `28` (number) _(example: `856`)_
      - `29` (number) _(example: `874`)_
      - `30` (number) _(example: `870`)_
      - `31` (number) _(example: `994`)_
      - `32` (number) _(example: `1491`)_
      - `33` (number) _(example: `881`)_
      - `34` (number) _(example: `853`)_
      - `35` (number) _(example: `864`)_
      - `36` (number) _(example: `878`)_
      - `37` (number) _(example: `868`)_
      - `38` (number) _(example: `886`)_
      - `39` (number) _(example: `873`)_
      - `40` (number) _(example: `857`)_
      - `41` (number) _(example: `858`)_
      - `42` (number) _(example: `1961`)_
      - `43` (number) _(example: `852`)_
      - `44` (number) _(example: `440`)_
  - `created_at` (string) _(example: `2023-04-14T03:30:26.562808+04:00`)_
  - `active` (boolean) _(example: `true`)_
  - `profile_type` (string) _(example: `Merchant`)_
  - `phones` (array)
    - `0` (string) _(example: `105xxxxxxxx`)_
  - `company_emails` (array)
    - `0` (string) _(example: `axxxxxxx@gmail.com`)_
  - `company_name` (string) _(example: `Retro`)_
  - `state` (string)
  - `country` (string) _(example: `ARE`)_
  - `city` (string) _(example: `temp`)_
  - `postal_code` (string)
  - `street` (string)
  - `email_notification` (boolean) _(example: `true`)_
  - `order_retrieval_endpoint` (string)
  - `delivery_update_endpoint` (string)
  - `logo_url` (string)
  - `is_mobadra` (boolean) _(example: `false`)_
  - `sector` (string)
  - `is_2fa_enabled` (boolean) _(example: `false`)_
  - `otp_sent_to` (string) _(example: `56xxxxx8`)_
  - `activation_method` (number) _(example: `1`)_
  - `signed_up_through` (string)
  - `failed_attempts` (string)
  - `custom_export_columns` (array)
  - `server_IP` (array)
  - `username` (string)
  - `primary_phone_number` (string) _(example: `+9715xxxxxxxx`)_
  - `primary_phone_verified` (boolean) _(example: `true`)_
  - `is_temp_password` (boolean) _(example: `false`)_
  - `otp_2fa_sent_at` (string)
  - `otp_2fa_attempt` (string)
  - `otp_sent_at` (string) _(example: `2023-04-14T03:30:32.788498+04:00`)_
  - `otp_validated_at` (string) _(example: `2023-04-14T03:32:24.616763+04:00`)_
  - `awb_banner` (string)
  - `email_banner` (string)
  - `identification_number` (string)
  - `delivery_status_callback` (string)
  - `merchant_external_link` (string)
  - `merchant_status` (string)
  - `deactivated_by_bank` (boolean) _(example: `false`)_
  - `bank_deactivation_reason` (string)
  - `bank_merchant_status` (string)
  - `national_id` (string)
  - `super_agent` (string)
  - `wallet_limit_profile` (string)
  - `address` (string)
  - `commercial_registration` (string)
  - `commercial_registration_area` (string)
  - `distributor_code` (string)
  - `distributor_branch_code` (string)
  - `allow_terminal_order_id` (boolean) _(example: `false`)_
  - `allow_encryption_bypass` (boolean) _(example: `false`)_
  - `wallet_phone_number` (string)
  - `suspicious` (string)
  - `latitude` (string)
  - `longitude` (string)
  - `bank_staffs` (object)
  - `bank_rejection_reason` (string)
  - `bank_received_documents` (boolean) _(example: `false`)_
  - `bank_merchant_digital_status` (string)
  - `bank_digital_rejection_reason` (string)
  - `filled_business_data` (boolean) _(example: `true`)_
  - `day_start_time` (string) _(example: `00:00:00`)_
  - `day_end_time` (string)
  - `withhold_transfers` (boolean) _(example: `false`)_
  - `manual_settlement` (boolean) _(example: `false`)_
  - `sms_sender_name` (string) _(example: `PayMob`)_
  - `withhold_transfers_reason` (string)
  - `withhold_transfers_notes` (string)
  - `can_bill_deposit_with_card` (boolean) _(example: `false`)_
  - `can_topup_merchants` (boolean) _(example: `false`)_
  - `topup_transfer_id` (string)
  - `referral_eligible` (boolean) _(example: `false`)_
  - `is_eligible_to_be_ranger` (boolean) _(example: `false`)_
  - `is_ranger` (boolean) _(example: `false`)_
  - `is_poaching` (boolean) _(example: `false`)_
  - `paymob_app_merchant` (boolean) _(example: `false`)_
  - `settlement_frequency` (string)
  - `day_of_the_week` (string)
  - `day_of_the_month` (string)
  - `allow_transaction_notifications` (boolean) _(example: `true`)_
  - `allow_transfer_notifications` (boolean) _(example: `true`)_
  - `sallefny_amount_whole` (string)
  - `sallefny_fees_whole` (string)
  - `paymob_app_first_login` (string) _(example: `2023-12-18T22:02:21.736025+04:00`)_
  - `paymob_app_last_activity` (string) _(example: `2024-09-17T15:59:14.950682+04:00`)_
  - `payout_enabled` (boolean) _(example: `false`)_
  - `payout_terms` (boolean) _(example: `false`)_
  - `is_bills_new` (boolean) _(example: `false`)_
  - `can_process_multiple_refunds` (boolean) _(example: `false`)_
  - `settlement_classification` (string)
  - `instant_settlement_enabled` (boolean) _(example: `false`)_
  - `instant_settlement_transaction_otp_verified` (boolean) _(example: `false`)_
  - `preferred_language` (string) _(example: `ar`)_
  - `ignore_flash_callbacks` (boolean) _(example: `false`)_
  - `acq_partner` (string)
  - `dom` (string)
  - `bank_related` (string)
  - `permissions` (array)
- `token` (string) _(example: `ZXlKaGJHY2lPaUpJVXpVeE1pxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxamc=`)_

