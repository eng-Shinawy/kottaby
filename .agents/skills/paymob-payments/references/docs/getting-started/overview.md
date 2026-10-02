---
title: "Overview"
url: https://developers.paymob.com/paymob-docs/getting-started/overview
tab: documentation
breadcrumbs: "Getting Started > Overview"
---

# Overview
![](https://d24lr4zqs1tgqh.cloudfront.net/00309fe7-70ff-46f2-9445-119be67c4f3d-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** - Anyone involved in setting up or managing payments with Paymob, including Merchants, Developers, and Product or technical teams

**Outcome** - know where to start, what you need, and which path makes the most sense for you

* * *

Paymob helps businesses accept online and in-person payments securely and at scale. Whether you’re just getting started with payment links, setting up an online store, or building a custom checkout from scratch, Paymob gives you a few different ways to integrate so you can choose what fits your business and technical setup.

This overview will help you understand what Paymob offers, which payment methods are available, and how to get up and running with the right integration.

### Who Is This For?

In our documentation, to help you with navigation, visual indicators are used to clarify the intended audience. When you see the People figure, the content applies to all users, including marketers and non-technical roles. When you see a code figure, the content is intended specifically for developers and may include technical or implementation-focused details. 

![](https://d24lr4zqs1tgqh.cloudfront.net/4d6f3b2e-f37b-4706-bc06-26d8fe0e98a5-696e9edc0acf4f5a50bce69f.svg)

### Everyone

Essential information for anyone getting started with Paymob.

![](https://d24lr4zqs1tgqh.cloudfront.net/e360f89d-c6f0-4e4d-aad5-7d5dba1bc609-696e9edc0acf4f5a50bce69f.svg)

### Developers

Detailed API documentation, integration guides, and technical specifications. Ideal for those implementing Paymob's payment solutions directly into applications or platforms.

### **Payment methods available**

Paymob supports a range of payment methods commonly used, so your customers can pay the way they prefer:

### Cards

![](https://d24lr4zqs1tgqh.cloudfront.net/eb7b2902-3bb2-43e5-8143-5e2369029793-696d49c90e7d4e9e101be737.png)

**Methods included:** Visa, Mastercard, Amex, MADA, OmanNet 

**When to use** : Standard online card payments with 3D Secure

### Mobile Wallets

![](https://d24lr4zqs1tgqh.cloudfront.net/b39d6b2b-f78f-4200-aa1b-98db27e3bc5f-696d49c90e7d4e9e101be737.png)

**Methods included:** Vodafone Cash, Orange Cash, e& money, We Pay, … in Egypt. Stc Pay in KSA **When to use:** Basic banking services are provided by banks and their agents (e.g., mobile network operators).

### Quick Payments

![](https://d24lr4zqs1tgqh.cloudfront.net/2664f921-cb0f-4d4f-8dd1-65fbd788017c-696d49c90e7d4e9e101be737.png)

**Methods included** : Apple Pay, Google Pay

**When to use:** Faster checkout using cards saved on the user’s device or browser

### BNPL

![](https://d24lr4zqs1tgqh.cloudfront.net/723f4b4c-b508-4236-8e19-d6e8e03329d7-696d49c90e7d4e9e101be737.png)

**Methods included:** (Tabby, Tamara) in the UAE and KSA(vaLU, Sympl, Souhoola, Halan, TRU, MOGO, …) in Egypt 

**When to use:** Allow customers to split payments into installments

### In-Person Payments

![](https://d24lr4zqs1tgqh.cloudfront.net/47a6c848-7f4b-450c-b292-c0007ff1224e-696d49c90e7d4e9e101be737.png)

**Methods included:** Tap to Pay 

**When to use** : Accept contactless payments on supported devices using the Paymob App

> **Warning:**
> 
> Not all payment methods are enabled by default. Availability depends on your merchant account setup. Reach out to your Paymob account manager if you need specific methods enabled.

Integration option

Best For

Time to launch (Estimated)

Technical level

Payment links| Freelancers, invoicing, social selling| Minutes| None  
---|---|---|---  
E-commerce plugins| Shopify, WooCommerce, Magento| Hours| Low  
Hosted checkout| PCI-compliant payment redirection| Days| Medium  
Pixel (Embedded)| Embedded checkout experience| Days–Weeks| High  
Mobile SDKs| iOS, Android, Flutter, React Native| Days–Weeks| High  
  
> **Info:**
> 
> You can always switch or expand later as your business grows.

###### 1

#### A customer starts a payment on your website or app

###### 2

#### Payment details are collected through a hosted or embedded checkout

###### 3

#### Paymob processes the payment and handles authentication

###### 4

#### Your system gets the result through a webhook

###### 5

#### The customer sees a success or failure confirmation

### **Ways to integrate with Paymob**

There’s more than one way to integrate Paymob. The right option depends on how technical your setup is and how quickly you want to launch.

![](https://d14vbsg24p2jga.cloudfront.net/295c4b84-8763-46a4-998b-5a8005513f88-696ce029f28038f7d24990ca.svg)

### Sandbox (Test)

What it's for: Development and testing

When to use it: While building and QA

![](https://d14vbsg24p2jga.cloudfront.net/83245c06-0208-4ac1-aa2c-b15a4a7eb9de-696ce029f28038f7d24990ca.svg)

### Production (Live)

What it's for: Real payments When to use it: After go-live approval

### **Not sure where to start?**

Use this quick guide:

  - **No developers involved?** → Start with [**Payment Links**](https://developers.paymob.com/paymob-docs/integration-paths/no-code/payment-links)

  - **Running a Shopify or WooCommerce store?** → Use an **E-commerce Plugin**

  - **Want a hosted payment page** → Go with **Hosted Checkout**

  - **Want an embedded payment experience, not redirection** → Go with **Pixel**

  - **Building a mobile app?** → Use the **Mobile SDKs**

**Egypt** : `https://accept.paymob.com/`

**Oman** : `https://oman.paymob.com/`

**Saudi Arabia:** `https://ksa.paymob.com/`

**United Arab Emirates:** ` https://uae.paymob.com/`

### **How payments work (at a high level)**

No matter which integration you choose, the payment flow stays mostly the same:

> **Info:**
> 
> Always use test credentials while developing.

You don’t need to handle sensitive card data yourself. Paymob takes care of that.

### **Test vs. live environments**

Paymob gives you two environments to work with:

![](https://d14vbsg24p2jga.cloudfront.net/d7db9f8a-bea1-46d0-a87b-c288443cecba-696ce029f28038f7d24990ca.svg)

### For all integrations

  - A Paymob merchant account

  - Access to the Paymob Dashboard

  - Completed business verification

> **Info:**
> 
> Test and live use the same regional base URL for each region. The mode is controlled by the keys and integration IDs you use.

![](https://d14vbsg24p2jga.cloudfront.net/a9025639-85e3-4244-a586-ef1f1ff7ca72-696ce029f28038f7d24990ca.svg)

### For API or SDK integrations

  - API Secret Key and Public Key

  - Integration ID(s) for your payment methods

  - A webhook endpoint

  - Success and failure redirect URLs

### **What you’ll need before you begin**

Here’s a quick checklist to help you prepare.

![](https://d14vbsg24p2jga.cloudfront.net/79c4573a-cb3d-403d-9426-62569cbc24b8-696ce029f28038f7d24990ca.svg)

### For e-commerce plugins

  - Admin access to your platform

  - Integration ID(s)

  - API key, secret key, and public key

### **Where to go next**

Depending on what you want to do, here’s where to continue:

Title

Description

Your goal| Start here  
---|---  
Accept your first payment quickly| Quick start guide  
Set up API credentials| API keys setup  
Test your integration| Test environment & credentials  
Prepare for production| Integration checklist  
Get guided setup| Onboarding wizard  
  
### **Need help?**

If you get stuck, you’re not on your own:

  - **Documentation:** Use the sidebar to explore all topics

  - **API reference:** Full API details live under Developer Reference

  - **Postman collection:** Try the APIs quickly using Postman

  - **Support:** [support@paymob.com](https://mailto:support@paymob.com)

  - **Community:** Join the Paymob Developer Community
