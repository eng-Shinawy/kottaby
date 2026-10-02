---
title: "List Subscription Plans"
url: https://developers.paymob.com/paymob-docs/subscription/plan-actions/list-subscription-plans
tab: developers
breadcrumbs: "Subscription > Plan actions > List Subscription Plans"
---

# List Subscription Plans
**Outcome** \- Restore all subscription plans associated with a specific merchant

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

`GET api/acceptance/subscription-plans`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Response 200

- `next` (string) _(example: `https://acccept.paymob.com/api/acceptance/subscription-plans?page=2`)_
- `previous` (string)
- `results` (array)
  - `0` (object)
    - `id` (number) _(example: `124`)_
    - `frequency` (number) _(example: `7`)_
    - `created_at` (string) _(example: `2024-09-20T15:47:49.225841+04:00`)_
    - `updated_at` (string) _(example: `2024-09-20T15:47:49.225874+04:00`)_
    - `name` (string) _(example: `plan`)_
    - `reminder_days` (string)
    - `retrial_days` (string)
    - `plan_type` (string) _(example: `rent`)_
    - `number_of_deductions` (string)
    - `amount_cents` (number) _(example: `3000`)_
    - `use_transaction_amount` (boolean) _(example: `false`)_
    - `is_active` (boolean) _(example: `true`)_
    - `webhook_url` (string)
    - `integration` (number) _(example: `349`)_
    - `fee` (string)

