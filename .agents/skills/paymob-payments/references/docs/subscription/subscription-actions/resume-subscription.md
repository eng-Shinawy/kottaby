---
title: "Resume Subscription"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/resume-subscription
tab: developers
breadcrumbs: "Subscription > Subscription actions > Resume Subscription"
---

# Resume Subscription
**Outcome** \- Reactivating a subscription and resuming billing

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

404 Not Found

```json
{
   "message":"Subscription not found."
}
``` 

**Solution** : Make sure to pass a valid subscription ID for the subscription you want resume

### The subscription isn't suspended

**400 Bad Request**

```json
{
   "message":"The subscription isn't suspended"
}
``` 

**Solution** : Make sure to pass an ID for an active subscription (Not cancelled or suspended)

* * *

## Endpoint

`POST api/acceptance/subscriptions/{Subscription_id}/resume`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_id` (String)

### Response 200

- `id` (number) _(example: `356`)_
- `client_info` (object)
  - `email` (string) _(example: `xxxxxxx@gmail.com`)_
  - `full_name` (string) _(example: `xxxxxxxxxxxxxxxx`)_
  - `phone_number` (string) _(example: `xxxxxxxxxxxxxxxxx`)_
- `frequency` (number) _(example: `7`)_
- `created_at` (string) _(example: `2024-09-20T22:07:42.889277+04:00`)_
- `updated_at` (string) _(example: `2024-09-20T22:07:42.889342+04:00`)_
- `name` (string) _(example: `Testplan 3`)_
- `reminder_days` (string)
- `retrial_days` (string)
- `plan_id` (number) _(example: `127`)_
- `state` (string) _(example: `active`)_
- `amount_cents` (number) _(example: `50000`)_
- `starts_at` (string) _(example: `2024-09-25`)_
- `next_billing` (string) _(example: `2024-09-25`)_
- `reminder_date` (string)
- `ends_at` (string)
- `resumed_at` (string) _(example: `2024-09-23`)_
- `suspended_at` (string) _(example: `2024-09-23`)_
- `webhook_url` (string) _(example: `https://webhook.site/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `integration` (number) _(example: `50428`)_
- `initial_transaction` (number) _(example: `540326`)_

