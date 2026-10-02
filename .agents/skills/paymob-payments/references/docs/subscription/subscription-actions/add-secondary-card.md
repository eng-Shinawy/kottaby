---
title: "Add Secondary Card"
url: https://developers.paymob.com/paymob-docs/subscription/subscription-actions/add-secondary-card
tab: developers
breadcrumbs: "Subscription > Subscription actions > Add Secondary Card"
---

# Add Secondary Card
**Outcome** \- Add a secondary card for an existing subscription 

* * *

To add a secondary card for an existing subscription you need to follow the steps below.

###### 1

### Create an Intention

You need to first create a payment intention. Please check the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

#### Card Types can be used

In this step, you can use one of the following [**Card Integration ID types**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions):

  - Verification (Recommended in this case)

  - Auth

  - Normal 3DS

#### Body Request

include the subscription ID in the `**subscriptionv2_id**`parameter in the **Intention Creation API** ; other parameters are explained in the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention).

#### Response

Important Parameter from Intention Response `**client_secret**`: Will be used in Step 2.

###### 2

### Render Paymob UI

You need to render one of Paymob UIs, so the customer can complete the payment and save their card.

#### UI Optins

  - Redirect the customer to [**Paymob's Unified Checkout**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/unified-checkout-redirection)

  - Render [**Paymob's Pixel component**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/pixel-embedded) for an embedded checkout experience

###### 3

### Processing the payment and saving the card

In the UI experience you used, the customer enters their card data and chooses to save their card for future use.

###### 4

### Receive Subscription Callback

You receive a Subscription callback in the endpoint registered to the subscription with the **trigger_type** parameter that contains the value “**add_secondry_card** ”

> **Info:**
> 
> The webhook_url is inherited from the [**Subscription Plan**](https://developers.paymob.com/paymob-docs/developers/subscription/create-subscription) by default. If no **webhook_url** is defined in the plan, or if you need to register a different **webhook_url** for a specific subscription, you can use the [**Register Webhook API**](https://developers.paymob.com/paymob-docs/developers/subscription/subscription-actions/register-webhook).

#### Sample Callback

```json
{
  "paymob_request_id": "f605f179-86ec-4b23-beab-1d2aa8f84892",
  "subscription_data": {
    "id": 7923,
    "client_info": {
      "email": "seofo@ss.com",
      "full_name": "Sayoufa Ahmed",
      "phone_number": "01010101010"
    },
    "frequency": 7,
    "created_at": "2026-01-19T12:35:27.455111",
    "updated_at": "2026-01-19T12:35:27.455124",
    "name": "Seifoplantrue",
    "reminder_days": 3,
    "retrial_days": null,
    "plan_id": 6977,
    "state": "active",
    "amount_cents": 20000,
    "starts_at": "2026-01-19",
    "next_billing": "2026-01-26",
    "reminder_date": "2026-01-23",
    "ends_at": "2026-02-02",
    "resumed_at": null,
    "suspended_at": null,
    "reactivated_at": null,
    "webhook_url": "https://webhook.site/286bcaf4-fc87-4f4d-a21c-409fe502cd6e",
    "integration": 4586631,
    "initial_transaction": 400122656
  },
  "trigger_type": "add_secondry_card",
  "hmac": "68ea52c07a5988144fdf616378c438ac207c68449d75f88e63f532820a8e11b1d5293c5f1d65fbe6fb1c0ffd5e1b24b6d422247f1cd13fe1c0c176d2c53840a0",
  "card_data": {
    "token": "c97803acc667b5bb1f22a0ead71e17d8e89dd2077455df30654b1d38",
    "is_primary": false,
    "masked_pan": "xxxx-xxxx-xxxx-0008"
  }
}
``` 

#### HMAC Calculation

Check it's the [**HMAC Subscription Callback**](https://developers.paymob.com/paymob-docs/developers/subscription/hmac-calculation-for-subscription-callback) guide under the callback section

> **Success:**
> 
> Now, you have added a secondary card to the subscription, you can make it the primary card to be used in future deductions for this subscription. You can use the [**Change Subscription Primary Card**](https://developers.paymob.com/paymob-docs/developers/subscription/subscription-actions/change-subscription-primary-card).
