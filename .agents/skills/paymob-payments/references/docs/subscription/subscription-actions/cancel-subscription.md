---
title: "Cancel Subscription"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/cancel-subscription
tab: developers
breadcrumbs: "Subscription > Subscription actions > Cancel Subscription"
---

# Cancel Subscription
**Outcome** \- Permanently terminate subscription

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

`POST api/acceptance/subscriptions/{Subscription_id}/cancel`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `Subscription_id` (string) — **required** — Unique identifier of the subscription to be cancelled

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `3`)_
- `client_info` (object) — Metadata or details about the client application used
  - `full_name` (string) — Full name of the customer associated with the subscription _(example: `Clifford Nicolas`)_
  - `email` (string) — Customer email address _(example: `claudette09@exa.com`)_
  - `phone_number` (string) — Customer phone number _(example: `+86(8)9135210487`)_
- `frequency` (number) — Billing frequency of the subscription (e.g., monthly, yearly) _(example: `7`)_
- `created_at` (string) — Timestamp when the record was created _(example: `2023-11-28T14:44:53.587174`)_
- `updated_at` (string) — Timestamp when the record was last updated _(example: `2023-11-28T14:44:53.587191`)_
- `name` (string) — Name of the item _(example: `Test Subscription`)_
- `reminder_days` (number) — Number of days before cancellation when a reminder is sent to the customer _(example: `3`)_
- `retrial_days` (number) — Number of days before retrying a failed payment _(example: `3`)_
- `plan_id` (number) — Unique identifier of the subscription plan _(example: `3`)_
- `state` (string) — State or province _(example: `canceled`)_
- `amount_cents` (number) — Transaction amount in cents _(example: `200`)_
- `starts_at` (string) — Timestamp when the subscription became active _(example: `2023-11-28`)_
- `next_billing` (string) — Scheduled date for the next billing cycle _(example: `2023-12-12`)_
- `reminder_date` (string) — Date when the cancellation reminder is sent to the customer _(example: `2023-12-09`)_
- `ends_at` (string) — Timestamp when the subscription is set to terminate
- `resumed_at` (string) — Timestamp indicating when the subscription was resumed after a pause _(example: `2023-12-05`)_
- `suspended_at` (string) — Timestamp indicating when the subscription was suspended _(example: `2023-12-05`)_
- `integration` (number) — Identifier for the third-party integration associated with the subscription _(example: `3381753`)_
- `initial_transaction` (number) — Details of the first transaction associated with the subscription _(example: `147018623`)_

