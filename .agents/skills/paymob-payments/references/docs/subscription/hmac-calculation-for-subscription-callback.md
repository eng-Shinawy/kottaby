---
title: "Subscription Callback and HMAC Calculation"
url: https://developers.paymob.com/paymob-docs/subscription/hmac-calculation-for-subscription-callback
tab: developers
breadcrumbs: "Subscription > Subscription Callback and HMAC Calculation"
---

# Subscription Callback and HMAC Calculation
**Outcome** \- Understand the subscription callback and calculate its HMAC

* * *

### Overview

When a webhook is registered to a subscription, any actions performed on the subscription will trigger a callback. This callback is sent as a **POST** request to the registered webhook, containing the updated subscription data. The **HMAC** value for this callback is provided in the body of the subscription callback request as a parameter named `**hmac**`(unlike transaction or card token callbacks, where it is typically sent as a query parameter).

### Subscription Callback Sample

```json
{
  "paymob_request_id": "df9e4ecf-12e0-4925-b258-65423f32bc98",
  "subscription_data": {
    "id": 1264,
    "client_info": {
      "email": "test@test.com",
      "full_name": "mo ay",
      "phone_number": "01010101010"
    },
    "frequency": 365,
    "created_at": "2024-12-03T22:11:02.280164",
    "updated_at": "2024-12-03T22:11:02.280179",
    "name": "Testplan 3",
    "reminder_days": null,
    "retrial_days": null,
    "plan_id": 1186,
    "state": "suspended",
    "amount_cents": 330,
    "starts_at": "2024-12-20",
    "next_billing": "2024-12-20",
    "reminder_date": null,
    "ends_at": null,
    "resumed_at": null,
    "suspended_at": "2024-12-03",
    "webhook_url": "https://webhook.site/a16ba9d5-4f4a-47dc-8005-e6ec2d197f26",
    "integration": 4565330,
    "initial_transaction": 241322967
  },
  "trigger_type": "suspended",
  "hmac": "dd5b3018888d9f98574cd180793db10d969b522e08c62baf2ea33357d1546b567b7fd79760e90046e90eaacf30024ede5539cbd0748bd9e6c005faf5117e0e7b"
}
``` 

### Subscription Trigger Types Catalog

Each subscription action triggers a webhook containing the relevant `trigger_type` value.

Action

trigger_type

CREATED| "Subscription Created"  
---|---  
  
SUSPENDED| "suspended"  
  
CANCELED| "canceled"  
  
RESUMED| "resumed"  
  
UPDATED| "updated"  
  
SECONDRY_CARD| "add_secondry_card"  
  
PRIMARY_CARD| "change_primary_card"  
  
DELETE_SECONDARY_CARD | “delete_card”  
  
REGISTER_WEBHOOK| "register_webhook"  
  
Next billing cycle| "Successful Transaction"  
  
Failed deduction transaction| “Failed Transaction“  
  
Failed retrial deduction transaction| “Failed Overdue Transaction”  
  

### HMAC Calculation Method 

#### 1\. **Extract the Relevant Parameters**

  - `subscription_data.id`: Subscription ID (`1264` in the example).

  - `trigger_type`: The action taken on the subscription (`suspended` in the example).

#### 2\. **Create the Concatenated String**

The string format is the concatenation of the `trigger_type ` \+ “for” + ` subscription_data.id`

`”{trigger_type}for{subscription_data.id}”`

Example: The string for the above object is “**suspendedfor1264** “

#### 3\. **Hash the String**

  - Use the `**SHA-512**` hashing algorithm.

  - Hash the concatenated string using the merchant’s HMAC secret key. (This step is the same as calculating [**HMAC for normal callbacks**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token))

> **Info:**
> 
> To know how to get your hamc secret, please check **the Getting Integration Credentials page**.

#### 4\. **Compare the HMAC**

Compare the HMAC value sent in the request body (`**hmac**` parameter) with the calculated HMAC. If they match, the request is authenticated.
