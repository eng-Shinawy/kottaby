---
title: "Subscriptions"
url: https://developers.paymob.com/paymob-docs/payments-and-features/core-features/subscriptions
tab: documentation
breadcrumbs: "Payments & Features > Core Features > Subscriptions"
---

# Subscriptions
![](https://d24lr4zqs1tgqh.cloudfront.net/36acfcb6-f4fc-4b7f-99bd-8004d9fc3a55-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** - Product managers, business owners, and stakeholders who want to offer **subscription-based payments** without building or managing complex recurring billing logic

**Outcome** \- understand what Paymob Subscriptions are and how they work, when to use subscriptions instead of manual recurring charges, the key benefits and limitations of the feature

* * *

Paymob's Subscriptions feature allows merchants to charge customers automatically on a recurring basis without the need to manually initiate a back-to-back request for each payment. Once a customer is enrolled, Paymob handles the recurring charges according to the defined schedule.

This feature is designed to simplify recurring billing while providing a consistent and secure payment experience.

* * *

### Key points

![](https://d24lr4zqs1tgqh.cloudfront.net/8f92c679-0149-4546-bad8-33fd39a5adff-696d49c90e7d4e9e101be737.svg)

### Automatic recurring payments

No repeated manual or API calls.

![](https://d24lr4zqs1tgqh.cloudfront.net/b333d225-b755-46e2-9f35-68048d978937-696d49c90e7d4e9e101be737.svg)

### Customer-friendly

Consistent, on-time charges without repeated checkouts.

![](https://d24lr4zqs1tgqh.cloudfront.net/e1dc1418-ee86-4949-a1fb-b9d9c207df9e-696d49c90e7d4e9e101be737.svg)

### Operational efficiency

Reduces manual effort and integration complexity.

![](https://d24lr4zqs1tgqh.cloudfront.net/3ea65d52-e21f-49c3-8bb9-c644a5eadb82-696d49c90e7d4e9e101be737.svg)

### Flexible

Supports fixed amounts, custom intervals, and retries for failed payments.

### Key Components

#### **Subscription Plan**

Defines the recurring payment terms, including amount, interval, and rules. It serves as the **blueprint** for recurring charges.

#### **Subscription**

Represents a customer’s active enrollment in a plan, with payments deducted automatically. It is the **execution** of the plan for a specific customer.

### Ideal use cases

  - Subscription services (monthly, yearly) 

  - Memberships and loyalty programs 

  - Digital content platforms 

  - Recurring utilities or services

### Technical Implementation 

> **Info:**
> 
> Check the technical implementation guide in the [**Subscriptions guide**](https://developers.paymob.com/paymob-docs/developers/subscription/create-subscription-plan) under the Developers Reference sections
