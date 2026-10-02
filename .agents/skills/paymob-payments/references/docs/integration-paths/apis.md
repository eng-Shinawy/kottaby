---
title: "APIs"
url: https://developers.paymob.com/paymob-docs/integration-paths/apis
tab: documentation
breadcrumbs: "Integration Paths > APIs"
---

# APIs
![](https://d14vbsg24p2jga.cloudfront.net/9f43ec87-6e1f-4f2f-8f3d-0f13ed673fc0-696ce029f28038f7d24990ca.svg)

**Who is this for -** Product managers and developers who need a high-level overview of how to integrate through APIs and our available checkout experiences

**Outcome -** Understand the overall API payment flow, the available checkout options, and how payment results are securely communicated back to your system

* * *

## When should you use APIs?

Use Paymob APIs if you are:

  - Building a **custom website** without a CMS or ready-made plugin

  - Using a platform that allows **calling third-party APIs** but has no direct Paymob integration

  - Building a **mobile app** and choosing to use a **web-based checkout in a WebView** instead of a native SDK

APIs give you flexibility while still relying on Paymob’s secure payment infrastructure.

## Integration flow

###### 1

#### Create a payment intention

Every payment starts by calling the **Intention Creation API** from your backend. You can check it in the [**Intention APIs**](https://developers.paymob.com/paymob-docs/developers/intention-apis/overview) section.

This step initializes the payment by defining:

  - Amount and currency

  - Allowed payment methods

  - Your internal order or reference ID

The response includes a reference (client secret) that is used to launch the checkout experience.

###### 2

#### Display a checkout experience to the customer

Once the intention is created, you present one of Paymob’s checkout experiences:

**Unified Checkout (Redirect)**

  - Customer is redirected to a [**Paymob-hosted checkout**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/overview) page

  - Fastest integration with minimal frontend effort

  - Paymob handles UI, validation, and security

**Embedded Checkout (Pixel)**

  - Paymob checkout UI component ([**Pixel**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/pixel-embedded)) is embedded inside your website or WebView

  - More control over the checkout look and feel

  - Sensitive payment data is still handled securely by Paymob

###### 3

#### Customer completes or cancels the payment

The customer enters their payment details and completes any required authentication (such as 3D Secure). Paymob processes the transaction and determines the final payment status.

###### 4

#### Callbacks (Webhooks)

After processing the payment, Paymob sends [**callbacks**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/overview) to your backend to notify you of the payment result and redirects the customer back to your website or app.

Callbacks should be used to:

  - Confirm the final payment status

  - Update order records

  - Trigger business actions (e.g., fulfillment, notifications)

  - Redirects are mainly for user experience

  - **Callbacks are the source of truth** for payment status

###### 5

#### Callback security (HMAC)

Each callback can be authenticated using [**HMAC verification**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac) to ensure it was sent by Paymob and was not altered. Always verify callbacks before trusting their data.
