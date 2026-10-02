---
title: "Mobile SDKs"
url: https://developers.paymob.com/paymob-docs/integration-paths/mobile-sdks
tab: documentation
breadcrumbs: "Integration Paths > Mobile SDKs"
---

# Mobile SDKs
![](https://d14vbsg24p2jga.cloudfront.net/9f43ec87-6e1f-4f2f-8f3d-0f13ed673fc0-696ce029f28038f7d24990ca.svg)

**Who is this for** \- Product managers and developers who need a high-level overview of how to integrate through Mobile SDKs

**Outcome** \- Understand the overall Mobile flow, the available checkout options, and how payment results are securely communicated back to your system

* * *

### When should you use Mobile SDKs?

Use Paymob Mobile SDKs if you are building a **native mobile application** and want a checkout experience that feels fully integrated with your app.

Mobile SDKs are recommended when you want a **native UI experience** without using WebViews

### Integration flow

###### 1

#### Create a payment intention

Every SDK payment starts from your backend by calling the [**Intention Creation API**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention).

This step is responsible for:

  - Defining the amount and currency

  - Selecting the allowed payment methods

  - Linking the payment to your internal order or reference ID

The response includes an **intention reference (client secret)** that will be passed to the Mobile SDK.

###### 2

#### Initialize the Mobile SDK

In your mobile app (iOS or Android), you initialize the Paymob Mobile SDK using the intention reference received from your backend.

At this stage:

  - The SDK is configured with the payment intention

  - No sensitive payment data is handled by your app

This keeps your mobile application outside the PCI scope.

###### 3

#### Present the native checkout UI

Once initialized, the SDK will handle presenting the checkout experience based on the selected integration flow:

  - **Normal (Hosted) Checkout:** The SDK presents Paymob’s full checkout screen as a separate UI 

  - **Embedded Checkout:** The SDK renders the checkout UI inside your app screen (within the configured view) 

In both cases:

  - The customer completes the payment inside the SDK 

  - Paymob handles input validation, security, and authentication (e.g. 3D Secure) 

###### 5

#### Callbacks and SDK result handling

After the payment is processed, Paymob **sends callbacks to your backend** with the final payment result and **returns a status to the mobile app via the SDK callback**.

  - **Backend callbacks** must be used to confirm the final payment status, update orders, and trigger business actions. **They are the source of truth.**

  - **SDK callbacks** should be used only to update the UI and show success or failure messages.

> **Warning:**
> 
> Always rely on backend callbacks, not SDK responses alone, to confirm payment success.

###### 6

#### Callback security (HMAC)

Each callback can be authenticated using [**HMAC verification**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac) to ensure it was sent by Paymob and was not altered. Always verify callbacks before trusting their data

### Technical Implementation 

> **Info:**
> 
> Check the technical implementation guide in the [**SDKs guide**](https://developers.paymob.com/paymob-docs/developers/mobile-sdks/overview) under the Developers Reference sections
