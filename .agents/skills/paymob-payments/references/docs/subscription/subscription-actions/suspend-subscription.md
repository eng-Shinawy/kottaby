---
title: "Suspend Subscription"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/suspend-subscription
tab: developers
breadcrumbs: "Subscription > Subscription actions > Suspend Subscription"
---

# Suspend Subscription
**Outcome** \- Suspending a subscription and temporarily stopping its active billing

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

### Invalid subscription ID

**404 Not Found**

```json
{
   "message":"Subscription not found."
}
``` 

**Solution** : Make sure to pass a valid subscription ID for the subscription you want suspend

* * *

## Endpoint

`POST api/acceptance/subscriptions/{subscription_id}/suspend`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `subscription_id` (string) — **required** — Unique identifier of the subscription to be suspended

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `356`)_
- `client_info` (object) — Information about the client or customer associated with the subscription
  - `email` (string) — Customer email address _(example: `xxxxxxxxxxxxx@gmail.com`)_
  - `full_name` (string) — The complete name associated with the subscription or customer _(example: `xxxxxxxxxxx`)_
  - `phone_number` (string) — Customer phone number _(example: `xxxxxxxxxx`)_
- `frequency` (number) — The interval at which the subscription renews or bills, e.g., monthly or yearly _(example: `7`)_
- `created_at` (string) — Timestamp when the record was created _(example: `2024-09-20T22:07:42.889277+04:00`)_
- `updated_at` (string) — Timestamp when the record was last updated _(example: `2024-09-20T22:07:42.889342+04:00`)_
- `name` (string) — Name of the item _(example: `Testplan 3`)_
- `reminder_days` (string) — The number of days prior to an event when a reminder is sent
- `retrial_days` (string) — The number of days before a suspended subscription is automatically retried
- `plan_id` (number) — Unique identifier of the subscription plan _(example: `127`)_
- `state` (string) — State or province _(example: `suspended`)_
- `amount_cents` (number) — Transaction amount in cents _(example: `50000`)_
- `starts_at` (string) — The timestamp indicating when the subscription or billing cycle begins _(example: `2024-09-25`)_
- `next_billing` (string) — The timestamp of the next billing date for the subscription _(example: `2024-09-25`)_
- `reminder_date` (string) — The scheduled date to send a reminder related to the subscription
- `ends_at` (string) — The timestamp when the subscription is scheduled to end or expire
- `resumed_at` (string) — The timestamp when a suspended subscription was resumed
- `suspended_at` (string) — The timestamp when the subscription was suspended _(example: `2024-09-23`)_
- `webhook_url` (string) — URL endpoint to receive webhook notifications related to subscription events _(example: `https://webhook.site/2xxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `integration` (number) — Identifier or metadata related to the system integration managing the subscription _(example: `50428`)_
- `initial_transaction` (number) — Details of the first transaction associated with the subscription _(example: `540326`)_

