---
title: "List Subscription Cards"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/list-subscription-cards
tab: developers
breadcrumbs: "Subscription > Subscription actions > List Subscription Cards"
---

# List Subscription Cards
**Outcome** \- List all the cards related to a specific subscription 

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

`GET api/acceptance/subscriptions/{Subscription_id}/card-tokens`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_id` (String)

### Response 200 — Successful response

- `0` (object)
  - `id` (number) _(example: `2086`)_
  - `card_data` (string)
  - `token` (string) _(example: `d8a66a5224633744ad67419c0a72d739e54b46f6f7276066ef7a6ecf`)_
  - `created_at` (string) _(example: `2025-01-15T08:57:18.599888`)_
  - `is_primary` (boolean) _(example: `true`)_
  - `masked_pan` (string) _(example: `xxxx-xxxx-xxxx-2346`)_
  - `failed_attempts` (number) _(example: `0`)_
- `1` (object)
  - `id` (number) _(example: `4351`)_
  - `card_data` (string)
  - `token` (string) _(example: `df28139bc38e2db27bf9b256187d8ab2ef8f7d9ad1804f02650e297f`)_
  - `created_at` (string) _(example: `2025-07-27T17:34:56.220140`)_
  - `is_primary` (boolean) _(example: `false`)_
  - `masked_pan` (string) _(example: `xxxx-xxxx-xxxx-0008`)_
  - `failed_attempts` (number) _(example: `3`)_

