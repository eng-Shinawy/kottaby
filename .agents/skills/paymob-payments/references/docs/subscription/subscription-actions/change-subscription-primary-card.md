---
title: "Change Subscription Primary card"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/change-subscription-primary-card
tab: developers
breadcrumbs: "Subscription > Subscription actions > Change Subscription Primary card"
---

# Change Subscription Primary card
**Outcome** \- Changing the primary card associated with a specific subscription

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

### Passing a wrong card ID

404 Not Found

```json
{
   "message":"Card not found."
}
``` 

**Solution** : Make sure to pass a valid ID for the card you want to set as a primary one.

* * *

## Endpoint

`POST api/acceptance/subscriptions/{Subscription_Id}/change-primary-card`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_Id` (string) — **required**

### Request body

- `card` (number) — To Change specific card to make it Primary,from any subscriptions, first check the list of subscription cards and then run this IP by selecting correct card id.Every card has its own id. _(example: `374`)_

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `4290`)_
- `card_data` (string)
- `token` (string) _(example: `8508fccfa0e78d6e4de952fc6bc8fba26155aba66fa2a23016d818b9`)_
- `created_at` (string) — Timestamp when the record was created _(example: `2025-07-23T16:00:57.896127`)_
- `is_primary` (boolean) _(example: `true`)_
- `masked_pan` (string) — Masked primary account number _(example: `xxxx-xxxx-xxxx-2346`)_
- `failed_attempts` (number)

