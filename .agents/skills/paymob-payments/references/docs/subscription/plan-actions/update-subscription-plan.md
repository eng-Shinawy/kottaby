---
title: "Update Subscription Plan"
url: https://developers.paymob.com/paymob-docs/subscription/plan-actions/update-subscription-plan
tab: developers
breadcrumbs: "Subscription > Plan actions > Update Subscription Plan"
---

# Update Subscription Plan
**Outcome** \- Change a subscription plan’s amount, number of deductions, and integration ID for a specific plan

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

`PUT api/acceptance/subscription-plans/{Subscription_Plan_Id}`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `Content-Type` (string) _(example: `application/json`)_

### Path parameters

- `Subscription_Plan_Id` (String)

### Request body

- `number_of_deductions` (number) _(example: `3`)_
- `amount_cents` (number) _(example: `1000`)_
- `integration` (number) _(example: `11111`)_

### Response 200

- `id` (number) _(example: `127`)_
- `frequency` (number) _(example: `7`)_
- `created_at` (string) _(example: `2024-09-20T18:07:56.185164+04:00`)_
- `updated_at` (string) _(example: `2024-09-24T17:54:36.669667+04:00`)_
- `name` (string) _(example: `Testplan 3`)_
- `reminder_days` (string)
- `retrial_days` (string)
- `plan_type` (string) _(example: `rent`)_
- `number_of_deductions` (number) _(example: `3`)_
- `amount_cents` (number) _(example: `1000`)_
- `use_transaction_amount` (boolean) _(example: `true`)_
- `is_active` (boolean) _(example: `true`)_
- `webhook_url` (string) _(example: `https://webhook.site/xxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `integration` (number) _(example: `11111`)_
- `fee` (string)

