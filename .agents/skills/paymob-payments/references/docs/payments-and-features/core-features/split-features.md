---
title: "Split Features"
url: https://developers.paymob.com/paymob-docs/payments-and-features/core-features/split-features
tab: documentation
breadcrumbs: "Payments & Features > Core Features > Split Features"
---

# Split Features
![](https://d24lr4zqs1tgqh.cloudfront.net/b0a61af6-b5a7-434d-9c24-970c4f57eff0-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** \- Product managers, business owners, and stakeholders who want to understand how Paymob supports flexible payment handling through split payments and fund distribution

**Outcome** \- Understand the available split options, how each one works at a high level, and determine which split feature best fits your business model

* * *

### What Are Split Features?

Split Features enable flexible payment handling by allowing a single payment to be either **distributed across multiple parties** or **fulfilled using more than one card**. This helps merchants support complex business models and improve payment success rates without changing the customer checkout experience.

Paymob supports two split modes:

  - **Split Amount** : One payment, multiple recipients

  - **Split Payment** : One payment, multiple cards

Each mode serves a different business need and is configured according to your account setup.

### Split Amount

#### Overview

Split Amount allows you to **divide a single payment amount among multiple parties**. Each party receives its predefined share from the same transaction.

#### How It Works

  - The customer completes one payment

  - The total amount is automatically split

  - Each party receives its allocated portion

The customer experiences a normal checkout flow, while settlement is handled according to the defined split rules.

![](https://d24lr4zqs1tgqh.cloudfront.net/8859195a-d6bd-46bb-a59c-843411337260.jpg)

![](null)

#### Common Use Cases

  - Marketplaces with multiple sellers

  - Platforms taking commissions

  - Partnerships and revenue-sharing models

### Split Payment

#### Overview

Split Payment allows customers to **use more than one card to complete a single payment** , with support for **up to three cards** per transaction.

#### How It Works

  - The total payment amount is divided across multiple cards

  - The customer selects the number of cards and provides card details for each portion

  - The payment is completed once all parts are successfully processed

This is still treated as a single payment, even though multiple cards are used.

![](https://d24lr4zqs1tgqh.cloudfront.net/ce11020c-54e0-43f5-8475-e415f619b70e.jpg)

#### Common Use Cases

  - Customers with card limits

  - High-value purchases

  - Corporate or shared payments

  - Scenarios where one card cannot cover the full amount

### Technical Implementation

> **Info:**
> 
> Check the technical implementation guide in the [**Split Features Implementation**](https://developers.paymob.com/paymob-docs/developers/split-features-implementation) guide under the Developers Reference sections
