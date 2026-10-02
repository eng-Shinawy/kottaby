---
title: "Overview"
url: https://developers.paymob.com/paymob-docs/quicklink-apis/overview
tab: developers
breadcrumbs: "QuickLink APIs > Overview"
---

# Overview
**Outcome** \- Understand what QuickLinks APIs are used for

* * *

QuickLinks APIs allow you to **programmatically create and manage payment links** using Paymob’s backend APIs. These links can then be shared with customers to complete payments through a Paymob-hosted checkout experience.

> **Info:**
> 
> Download the Postman Collection from this [**link**](https://github.com/PaymobAccept/API-Postman-Collections/blob/main/V2%20QuickLink%20API%20Final.postman_collection).

### What Are QuickLinks APIs?

QuickLinks APIs enable you to:

  - Create secure, Paymob-hosted payment links programmatically 

  - Define payment details such as amount, currency, and allowed payment methods 

  - Cancel payment links from your backend 

Once created, a QuickLink can be shared with customers through any communication channel, allowing them to complete the payment without additional integration steps.

### Available API Operations

#### [**Create QuickLink**](https://developers.paymob.com/paymob-docs/developers/quicklink-apis/create-quicklink)

Use this API to generate a new payment link with predefined payment details and configurations.

#### [**Cancel QuickLink**](https://developers.paymob.com/paymob-docs/developers/quicklink-apis/cancel-quicklink)

Use this API to invalidate an existing payment link and prevent it from being used for future payments.

> **Warning:**
> 
> Always rely on backend callbacks, not the response (redirection) callback alone, to confirm payment success.
