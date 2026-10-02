---
title: "Overview"
url: https://developers.paymob.com/paymob-docs/integration-paths/overview
tab: documentation
breadcrumbs: "Integration Paths > Overview"
---

# Overview
![](https://d24lr4zqs1tgqh.cloudfront.net/4530f344-97c3-4b8f-8482-4525e6421e6b-696e9edc0acf4f5a50bce69f.svg)

**Who is this for -** Product managers and developers who need a high-level overview to plan the payment feature for their app or website

**Outcome -** Understand the overall payment flow and the available integration options

* * *

### Overview

The figure below is a high-level view of the payments architecture, from user touchpoints to transaction execution, designed to guide decisions across wallets, cards, installments, and post-payment actions. This will help you map **what** you’re building, **how** you’re integrating, and **which** payment methods and flows you support.

![](https://d24lr4zqs1tgqh.cloudfront.net/6727e475-8c87-4ebf-93b3-8152ace49951.jpg)

### **Phase 1: Define Your Product & Integration Method**

Start by defining what you are building and how you will connect to us.

###### 1

#### What are you building?

  - Website

  - Mobile Application

###### 2

#### How are you building it?

  - [**Custom-built**](https://developers.paymob.com/paymob-docs/integration-paths/apis) website or mobile application with our web UI (through a webview in case of mobile app)

  - [**E-commerce platform**](https://developers.paymob.com/paymob-docs/integration-paths/plugins)

  - [**SDK**](https://developers.paymob.com/paymob-docs/integration-paths/mobile-sdks)

> **Warning:**
> 
> The **webview** doesn't support the Apple Pay payment method; you should integrate through the **SDK**.

### **Phase 2: Choose Your Payment Options**

Select the payment methods and types that match your needs.

###### 1

#### Which Payment method will you offer?

Please check the supported [**Payment Methods**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods) section to get full guidance on each payment method and the integration ways that support it.

###### 2

#### Which payment feature will you use?

  - **Normal 3D Secure (3DS)** : Please check the **3D Secure (3DS)** explained in the [**Card payment method**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions) page to know more about it.

  - **Auth/Cap** : Please check the [**Auth/Cap**](https://developers.paymob.com/paymob-docs/payments-and-features/core-features/auth-cap) page to know more about it.

  - **Pay with saved tokens** : Please check the [**Pay With Saved Cards**](https://developers.paymob.com/paymob-docs/payments-and-features/core-features/pay-with-saved-cards) section to know more about it and its types (**MIT** and **CIT**), and how to implement each of them.

> **Info:**
> 
> For the subscription module, which enables you to configure subscriptions that Paymob will use in the future to deduct an amount periodically without your intervention in the next billings, please check the [**Subscriptions**](https://developers.paymob.com/paymob-docs/payments-and-features/core-features/subscriptions) section.

### **Phase 3: The Payment Actions you can take**

Determine what payment actions you’ll perform.

**1\. What are the payment actions you'll perform?**

Please check the [**Managing Payment Actions**](https://developers.paymob.com/paymob-docs/payments-and-features/managing-payments) section to know more about the available payment actions and how to do each one through **the Paymob dashboard** or **APIs**.

If you are still confused regarding the path you'll follow to implement your needed payment experience, please send an email to [**support@paymob.com**](mailto:support@paymob.com), and we'll be glad to help you get the best payment experience for your business.
