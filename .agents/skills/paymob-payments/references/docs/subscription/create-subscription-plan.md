---
title: "Create Subscription plan"
url: https://developers.paymob.com/paymob-docs/subscription/create-subscription-plan
tab: developers
breadcrumbs: "Subscription > Create Subscription plan"
---

# Create Subscription plan
**Outcome** \- Create a subscription plan that defines the characteristics of periodic subscription deductions per user.

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Paymob%20Subscription%20Module%20API%20Final.postman_collection).

### **Authorization**

You should send a valid auth token as a Bearer Token. 

> **Info:**
> 
> You can get a valid auth token by [**Authentication Request (Generate Auth Token)**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1)

> **Warning:**
> 
> **Important Notes:**
> 
> \- Please make sure to use the **Moto integration ID** while creating a subscription plan.
> 
> \- You need to set the parameter '**webhook_url** ' while creating the plan request, then you will start receiving the response on the webhook on any action (subscription level only).

* * *

#### Common errors


### Wrong frequency

400 Bad Request

```json
{
    "frequency": [
        "\"5\" is not a valid choice."
    ]
}
``` 

**Solution** : Make sure to use a valid frequency value from (**7, 15, 30, 60, 90, 180, 360**).

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

`POST api/acceptance/subscription-plans`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Request body

- `frequency` (number) — **required** — Specify the frequency of deduction (e.g., Weekly, Biweekly, Monthly, Two months, Quarterly, Half annual, Yearly). Values in numbers are (7, 15, 30, 60, 90, 180, 360). _(example: `7`)_
- `name` (string) — **required** — Name the subscription plan for identification purposes. The maximum number of characters is 200. _(example: `Testplan 3`)_
- `webhook_url` (string) — You need to enter the unique webhook URL in this parameter _(example: `https://webhook.site/xxxxxxxxxxxxxxxxxxxx`)_
- `reminder_days` (string) — Specify the number of days before which you want to send a notification to the customer to pay (currently supporting email notifications).
- `retrial_days` (string) — Define the days on which the subscription will be attempted again in case of a failure to collect the previous subscription amount.
- `plan_type` (string) — The type of subscription plan. It accepts the values (rent) and the default is “rent.” _(example: `rent`)_
- `number_of_deductions` (string) — The number of deductions from this subscription. The default value is null.
- `amount_cents` (number) — Specify the subscription amount that will be charged. _(example: `50000`)_
- `use_transaction_amount` (boolean) — If this flag is enabled, the system will use the first transaction amount instead of the specified subscription amount. Otherwise, it will use the subscription amount from the “Amount Cents”. Default value is false _(example: `true`)_
- `is_active` (boolean) — Indicates whether the plan will be created, will be active, or will be paused. The default value is true. _(example: `true`)_
- `integration` (number) — **required** — MIGS Moto Integration ID, which will be used for upcoming transactions (recurring transactions). _(example: `11111`)_
- `fee` (string)

### Response 200 — Successful response

- `id` (number) — Unique identifier for the transaction _(example: `127`)_
- `frequency` (number) _(example: `7`)_
- `created_at` (string) — Timestamp when the record was created _(example: `2024-09-20T18:07:56.185164+04:00`)_
- `updated_at` (string) — Timestamp when the record was last updated _(example: `2024-09-20T18:07:56.185201+04:00`)_
- `name` (string) — Name of the item _(example: `Testplan 3`)_
- `reminder_days` (string)
- `retrial_days` (string)
- `plan_type` (string) _(example: `rent`)_
- `number_of_deductions` (string)
- `amount_cents` (number) — Transaction amount in cents _(example: `50000`)_
- `use_transaction_amount` (boolean) _(example: `true`)_
- `is_active` (boolean) — Indicates if the subscription is active _(example: `true`)_
- `webhook_url` (string) _(example: `https://webhook.site/xxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `integration` (number) _(example: `50428`)_
- `fee` (string)

