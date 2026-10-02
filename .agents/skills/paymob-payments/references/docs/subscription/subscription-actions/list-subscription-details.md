---
title: "List Subscription Details"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/list-subscription-details
tab: developers
breadcrumbs: "Subscription > Subscription actions > List Subscription Details"
---

# List Subscription Details
**Outcome** - Retrieving detailed information for a specific subscription using its unique subscription ID, or fetching all subscriptions associated with a specific merchant.

* * *

### **Authorization**

You should send a valid auth token as a Bearer Token. 

> **Info:**
> 
> You can get a valid auth token by [**Authentication Request (Generate Auth Token)**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1)

### Query Parameters

> **Info:**
> 
> You can filter subscriptions using the following parameters:
> 
>   - **Transaction**
> 
>   - P**lan**
> 
>   - **Subscription state**
> 
> 

> 
> Refer to the query parameters listed below for more details.

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

### Passing a non-valid subscription ID

404 Not Found

```json
{
   "detail":"not found."
}
``` 

**Solution** : Make sure to pass a valid subscription ID for the subscription you want to retrieve its details.

* * *

## Endpoint

`GET api/acceptance/subscriptions/{Subscription_id}`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_id` (string)

### Query parameters

- `transaction` (string) — Retrieving the subscription related to either initial transactions or auto deduction transactions
- `plan_id` (string) — Listing all the subscriptions related to the plan ID subscriptions
- `Subscriptions state` (string) — Listing all the subscriptions related to the subscription state

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `356`)_
- `client_info` (object)
  - `email` (string) — Customer email address _(example: `xxxxxxxxxxxxx@gmail.com`)_
  - `full_name` (string) _(example: `xxxxxxxxxxxxxxx`)_
  - `phone_number` (string) — Customer phone number _(example: `+xxxxxxxxxxxxxx`)_
- `frequency` (number) _(example: `7`)_
- `created_at` (string) — Timestamp when the record was created _(example: `2024-09-20T22:07:42.889277+04:00`)_
- `updated_at` (string) — Timestamp when the record was last updated _(example: `2024-09-20T22:07:42.889342+04:00`)_
- `name` (string) — Name of the item _(example: `Testplan 3`)_
- `reminder_days` (number)
- `retrial_days` (number)
- `plan_id` (number) _(example: `127`)_
- `state` (string) — State or province _(example: `active`)_
- `amount_cents` (number) — Transaction amount in cents _(example: `50000`)_
- `starts_at` (string) _(example: `2024-09-25`)_
- `next_billing` (string) _(example: `2024-09-25`)_
- `reminder_date` (string)
- `ends_at` (string)
- `resumed_at` (string) _(example: `2024-09-23`)_
- `suspended_at` (string) _(example: `2024-09-23`)_
- `webhook_url` (string) _(example: `https://webhook.site/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `integration` (number) _(example: `50428`)_
- `initial_transaction` (number) _(example: `540326`)_

