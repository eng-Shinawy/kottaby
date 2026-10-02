---
title: "Create Subscription"
url: https://developers.paymob.com/paymob-docs/subscription/create-subscription
tab: developers
breadcrumbs: "Subscription > Create Subscription"
---

# Create Subscription
**Outcome** \- Create a subscription for a user under a specific subscription plan.

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Paymob%20Subscription%20Module%20API%20Final.postman_collection).

### Subscription Creation Mechanism 

Subscription creation is being done by completing one 3DS transaction to save the customer's card and connect it with the subscription. To implement this, please check the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

Below are the specific technical details related to the subscription itself, not the Intention in general.

### Request Body

Below are the parameters related to the subscription creation; other parameters are explained in the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

Field

Description

Mandatory

Subscription Plan ID(subscription_plan_id)| The subscription plan ID from which the subscription inherits its characteristics.| Yes  
---|---|---  
  
Subscription Start Date(subscription_start_date)| The date from which the subscription will start. It's effective if the use_transaction_amount value is false.| No  
  
* * *

#### Common errors


### Wrong secret key was used for authentication 

404 Not Found

```json
{
    "message": "invalid subscription plan id"
}
``` 

**Solution** : Make sure that the secret key and plan ID belong to the same Paymob account.

* * *
