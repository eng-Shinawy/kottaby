---
title: "Create Card Token"
url: https://developers.paymob.com/paymob-docs/pay-with-saved-cards/create-card-token
tab: developers
breadcrumbs: "Pay With Saved Cards > Create Card Token"
---

# Create Card Token
**Outcome** \- Create a Card Token to be used in future payments

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Pay%20with%20saved%20card%20Final.postman_collection).

###### 1

### Create an Intention

You need to first create a payment intention. Please check the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

#### Card Types can be used

In this step, you can use one of the following [**Card Integration ID types**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions):

  1. **Verification**

  2. **Normal 3DS**

  3. **Auth**

#### Important Parameters from Intention Response

`**client_secret**`: Will be used in **Step 2**.

`**intention_order_id**`: The Paymob order ID, which you'll receive on both the transaction callback and the card token callback. Will be used to correlate the transaction or the card token to the order or customer on your system.

`**id**`: The intention ID, which you'll receive on both the transaction callback and the card token callback. Will be used to correlate the transaction or the card token to the order or customer on your system. (Same use of Order ID)

###### 2

### Render Paymob UI

You need to render one of Paymob UIs, so the customer can complete the payment and save their card.

#### UI Optins

  1. Redirect the customer to [**Paymob's Unified Checkout**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/unified-checkout-redirection)

  2. Render [**Paymob's Pixel component**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/pixel-embedded) for an embedded checkout experience 

###### 3

### Processing the payment and saving the card

In the UI experience you used, the customer enters their card data and chooses to save their card for future use.

###### 4

### Receiving the Card Token

You receive a **Card Token** object in the endpoint sent in the `**notification_url**`parameter while creating the intention (**Step 1**), or in the endpoint configured as a processed callback URL in the integration ID you used.

#### Sample Card Token Object

```json
{
  "type": "TOKEN",
  "obj": {
    "id": 8555026,
    "token": "e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab",
    "masked_pan": "xxxx-xxxx-xxxx-2346",
    "merchant_id": 246628,
    "card_subtype": "MasterCard",
    "created_at": "2024-11-13T12:32:23.859982",
    "email": "test@test.com",
    "order_id": "264064419",
    "user_added": false,
    "next_payment_intention": "pi_test_2a9c29ead1734ce8ad09ae4936019992"
  }
}
``` 

#### HMAC Calculation 

Check it's the [**HMAC Card Token Callback**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-for-card-tokens) guide under the callback section

> **Success:**
> 
> Now, you have the token that represents the customer's card, and you can use it in future payments, either a [**Customer Initiated Transaction** (**CIT)**](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/cit) or a [**Merchant Initiated Transaction** (**MIT)**](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/mit)
