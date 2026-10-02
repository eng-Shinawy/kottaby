---
title: "Update Subscription"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/update-subscription
tab: developers
breadcrumbs: "Subscription > Subscription actions > Update Subscription"
---

# Update Subscription
**Outcome** \- Modifying the subscription amount and the subscription end date for a specific subscription

* * *

### Authorization 

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

`PUT api/acceptance/subscriptions/{Subscription_Id}`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_Id` (string) — **required**

### Request body

- `amount_cents` (number) — New subscription amount in cents _(example: `300`)_
- `ends_at` (string) — New subscription end date _(example: `2026-12-31`)_
- `next_billing` (string) — New subscription billing_date. (Mostly will be used if the subscription was suspended for a while) _(example: `2026-05-31`)_

### Response 200 — Successful response

- `id` (number) _(example: `2046`)_
- `client_info` (object)
  - `email` (string) _(example: `msttar@gmail.com`)_
  - `full_name` (string) _(example: `Mohamed Sttar`)_
  - `phone_number` (string) _(example: `010101010`)_
- `frequency` (number) _(example: `7`)_
- `created_at` (string) _(example: `2025-01-15T08:57:18.589410`)_
- `updated_at` (string) _(example: `2025-01-15T08:57:18.589423`)_
- `name` (string) _(example: `Testplan 3`)_
- `reminder_days` (string)
- `retrial_days` (string)
- `plan_id` (number) _(example: `1959`)_
- `state` (string) _(example: `active`)_
- `amount_cents` (number) _(example: `300`)_
- `starts_at` (string) _(example: `2025-01-15`)_
- `next_billing` (string) _(example: `2026-05-31`)_
- `reminder_date` (string)
- `ends_at` (string)
- `resumed_at` (string)
- `suspended_at` (string)
- `reactivated_at` (string)
- `webhook_url` (string)
- `integration` (number) _(example: `2002433`)_
- `initial_transaction` (number) _(example: `254753658`)_

