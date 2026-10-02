---
title: "MIT (Merchant Initiated Transaction)"
url: https://developers.paymob.com/paymob-docs/pay-with-saved-cards/mit
tab: developers
breadcrumbs: "Pay With Saved Cards > MIT (Merchant Initiated Transaction)"
---

# MIT (Merchant Initiated Transaction)
**Outcome** \- Make the merchant deduct from a saved card without the customer's interaction

* * *

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Pay%20with%20saved%20card%20Final.postman_collection).

### Pre-requisites 

  - Create a card token. You can check the [**Create Card Token**](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/create-card-token) guide.

###### 1

### Create an Intention

You need to first create a payment intention. Please check the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

#### Card Types can be used

In this step, you can use one of the following [**Card Integration ID types**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions):

  - **Moto**

#### Response

**Important Parameters from Intention Response**

`**payment_keys[0].key**`: The Moto payment token that will be used in **Step 2**.

> **Info:**
> 
> Payment Token: is a unique identifier for payment with specific payment method.

###### 2

### Call The Pay Request

You need to pass the card token and the payment token to the **Pay Request**. Which we'll deep dive into below.

> **Info:**
> 
> For the callbacks and HMAC calculation, you can check the [**Webhook (Callbacks) & HMAC**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/overview) section.

* * *

## Endpoint

`POST api/acceptance/payments/pay`

**Content-Type:** `application/json`

### Request body

- `source` (object)
  - `identifier` (string) — **required** — The token that represents the card you want to deducte from _(example: `e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab`)_
  - `subtype` (string) — **required** — The type of the payment. In this case it will be ** "TOKEN" ** _(example: `TOKEN`)_
- `payment_token` (string) — A unique identifier for payment with specific payment method. _(example: `ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

