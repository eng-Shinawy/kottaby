---
title: "CIT (Customer Initiated Transaction)"
url: https://developers.paymob.com/paymob-docs/pay-with-saved-cards/cit
tab: developers
breadcrumbs: "Pay With Saved Cards > CIT (Customer Initiated Transaction)"
---

# CIT (Customer Initiated Transaction)
**Outcome** \- Make the customer pay with the saved card through one of Paymob UIs without reentering his card details

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Pay%20with%20saved%20card%20Final.postman_collection).

### Pre-requisites 

  - Create a card token, you can check the [**Create Card Token**](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/create-card-token) guide.

###### 1

### Create an Intention

You need to first create a payment intention. Please check the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

#### Card Types can be used

In this step, you can use one of the following [**Card Integration ID types**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions):

  - **Normal 3DS**

  - **Auth**

  - **Card On File**

#### Body Request

Include the card token as a string in the `**card_tokens**`array when calling the Create Intention API; other parameters are explained in the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention).

> **Info:**
> 
> `**card_tokens**` array accepts up to 3 card tokens.

#### Response

**Important Parameters from Intention Response**

`**client_secret**`: Will be used in Step 2.

###### 2

### Render Paymob UI

You need to render one of Paymob UIs, so the customer can complete the payment and save their card.

#### UI Optins

  - Redirect the customer to [**Paymob's Unified Checkout**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/unified-checkout-redirection)

  - Render [**Paymob's Pixel component**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/pixel-embedded) for an embedded checkout experience

###### 3

### Processing the payment and saving the card

In the UI experience you used, the customer enters their card data and chooses to save their card for future use.

> **Info:**
> 
> For the callbacks and HMAC calculation, you can check the [**Webhook (Callbacks) & HMAC**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/overview) section.
