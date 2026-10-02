---
title: "Register Webhook"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/register-webhook
tab: developers
breadcrumbs: "Subscription > Subscription actions > Register Webhook"
---

# Register Webhook
**Outcome** \- Register a webhook endpoint to an existing subscription 

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

`POST api/acceptance/subscriptions/{subID}/register_webhook`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (String) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `subID` (String) — which you need to register a webhook for

### Request body

- `url` (string) — You should only pass the "url" parameter _(example: `https://webhook`)_

### Response 200

- `id` (number) _(example: `368`)_
- `client_info` (object)
  - `email` (string) _(example: `xxxxxxxxxxxx@gmail.com`)_
  - `full_name` (string) _(example: `Axxxxxxx`)_
  - `phone_number` (string) _(example: `+96xxxxxxxxxxx8`)_
- `frequency` (number) _(example: `7`)_
- `created_at` (string) _(example: `2024-09-27T10:02:46.440220+04:00`)_
- `updated_at` (string) _(example: `2024-09-27T10:02:46.440254+04:00`)_
- `name` (string) _(example: `Testplan 3`)_
- `reminder_days` (string)
- `retrial_days` (string)
- `plan_id` (number) _(example: `140`)_
- `state` (string) _(example: `active`)_
- `amount_cents` (number) _(example: `20000`)_
- `starts_at` (string) _(example: `2024-09-27`)_
- `next_billing` (string) _(example: `2024-10-04`)_
- `reminder_date` (string)
- `ends_at` (string)
- `resumed_at` (string)
- `suspended_at` (string)
- `webhook_url` (string) _(example: `https://webhook.site/f3ab2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx5`)_
- `integration` (number) _(example: `50428`)_
- `initial_transaction` (number) _(example: `557253`)_

