---
title: "Delete Secondary Card"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/delete-secondary-card
tab: developers
breadcrumbs: "Subscription > Subscription actions > Delete Secondary Card"
---

# Delete Secondary Card
**Outcome** \- Delete a secondary card for a specific subscription

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

`POST api/acceptance/subscriptions/{Subscription_id}/delete-card`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (String) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_id` (String) — which you need to delete the secondary card from

### Request body

- `card` (number) — **required** — The ID of the card that needs to be deleted _(example: `373`)_

