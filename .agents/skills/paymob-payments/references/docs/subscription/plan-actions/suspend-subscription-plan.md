---
title: "Suspend Subscription Plan"
url: https://developers.paymob.com/paymob-docs/subscription/plan-actions/suspend-subscription-plan
tab: developers
breadcrumbs: "Subscription > Plan actions > Suspend Subscription Plan"
---

# Suspend Subscription Plan
**Outcome** \- Suspend a subscription plan

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

`POST api/acceptance/subscription-plans/{subscription_plan_id}/suspend`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (String) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `Content-Type` (string) _(example: `application/json`)_

### Path parameters

- `subscription_plan_id` (String)

### Response 200

- `id` (number) _(example: `127`)_
- `frequency` (number) _(example: `7`)_
- `created_at` (string) _(example: `2024-09-20T18:07:56.185164+04:00`)_
- `updated_at` (string) _(example: `2024-09-20T18:07:56.185201+04:00`)_
- `name` (string) _(example: `Testplan 3`)_
- `reminder_days` (string)
- `retrial_days` (string)
- `plan_type` (string) _(example: `rent`)_
- `number_of_deductions` (string)
- `amount_cents` (number) _(example: `50000`)_
- `use_transaction_amount` (boolean) _(example: `true`)_
- `is_active` (boolean) _(example: `false`)_
- `webhook_url` (string) _(example: `https://webhook.site/xxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `integration` (number) _(example: `11111`)_
- `fee` (string)

