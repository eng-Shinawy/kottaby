---
title: "Overview"
url: https://developers.paymob.com/paymob-docs/checkout-experiences/overview
tab: developers
breadcrumbs: "Checkout Experiences > Overview"
---

# Overview
**Outcome** \- Understand the checkout experiences supported by Paymob, and know when to use **Unified Checkout** vs. **Pixel**.  
  
* * *

Paymob offers two flexible checkout experiences to help you accept payments online. Each experience supports different merchant needs and integration preferences, while both rely on Paymob’s **Intention API** as the initial step.

### Checkout Options

#### [**Unified Checkout**](https://developers.paymob.com/paymob-docs/checkout-experiences/unified-checkout-redirection)

**Unified Checkout** is Paymob’s **redirect-based payment experience**. When a customer is ready to pay, you redirect them to Paymob’s hosted checkout page, where they enter their payment details and complete the transaction.

The flow generally involves [**creating a payment intention**](https://developers.paymob.com/paymob-docs/intention-apis/create-intention), then directing the customer’s browser to the hosted checkout using the generated client secret

> **Info:**
> 
> You can customize the Unified Checkout appearance through the [**Checkout Customization**](https://accept.paymob.com/portal2/en/checkout-customization) section in the [**dashboard**](https://developers.paymob.com/paymob-docs/getting-started/dashboard).

#### [**Pixel**](https://developers.paymob.com/paymob-docs/checkout-experiences/pixel-embedded)

**Pixel** is Paymob’s **JavaScript SDK** that enables an **embedded checkout experience** directly on your site or application. Instead of redirecting the customer to a separate page, Pixel allows you to integrate payment elements inside your own UI.

Pixel is ideal for:

  - Seamless, branded checkout experiences 

  - Embedded **Card, Apple Pay,** and **Google Pay**

  - Businesses that want checkout UI inside their website without redirection 

Pixel accepts configuration (such as payment methods and an HTML container ID) and uses the client secret from the previously created intention to render the payment UI in place.

### How They Work

Both checkout experiences share the same **initial requirement** :

  1. [**Create an intention**](https://developers.paymob.com/paymob-docs/intention-apis/create-intention) Use the intention API to specify the payment amount, currency, and available methods. This returns a **client secret** that is unique to that payment attempt. 

  2. **Render checkout**

  3. **Unified Checkout:** Redirect the customer to a hosted payment page using the client secret.

  4. **Pixel:** Embed the payment UI inside your site using the SDK and client secret.

> **Info:**
> 
> The client secret serves as the bridge between your backend (where you create the intention) and the checkout UI (hosted or embedded) that the customer interacts with.

### Choosing Between Unified Checkout and Pixel

Feature

Unified Checkout 

Pixel

Checkout location |  Redirect to hosted page |  Embedded on your site   
---|---|---  
  
Branding control |  Standard Paymob look, with simple customization |  Matches your UI   
  
Setup complexity |  Simple |  Requires SDK integration   
  
Best for |  Quick integration |  Custom embedded experience
