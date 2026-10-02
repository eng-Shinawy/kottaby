---
title: "Overview"
url: https://developers.paymob.com/paymob-docs/intention-apis/overview
tab: developers
breadcrumbs: "Intention APIs > Overview"
---

# Overview
**Outcome** \- Understand what Paymob's Payment Intention is, and its APIs

* * *

### Definition 

**Intention** : The initial component of any payment that contains key details such as the payment amount, customer information, currency, and the available payment methods.

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/Intention%20APIs.postman_collection%201.json).

### When will it be used?

It will be used each time you need to create a payment. It will be used with:

  - Normal redirection integration on a website

  - Embedded experience (Pixel) on a website

  - Integrating with our SDKs

  - Create subscription

  - Auth/Cap payment model

  - Pay with saved cards

### Available actions

#### Create Intention

You can create an intention by using the [**Create Intention AP**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)**I** , passing the amount that should be paid, customer info, and other information.

#### Update Intention

You can update an already existing intention by using the [**Update Intention API**](https://developers.paymob.com/paymob-docs/developers/intention-apis/update-intention), passing the amount that should be paid, customer info, and other information.

> **Warning:**
> 
> \- If you're integrating through [**SDK**](https://developers.paymob.com/paymob-docs/integration-paths/mobile-sdks), you need to [**create Apple Pay certificates**](https://developers.paymob.com/paymob-docs/need-help/faq/apple-pay-certificates-creation).
> 
> \- If you're integrating through [**Pixel**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/pixel-embedded)(Embedded experience), you need to [**verify your domain**](https://developers.paymob.com/paymob-docs/need-help/faq/apple-pay-domain-verification), and you need to [**create Apple Pay certificates**](https://developers.paymob.com/paymob-docs/need-help/faq/apple-pay-certificates-creation).
