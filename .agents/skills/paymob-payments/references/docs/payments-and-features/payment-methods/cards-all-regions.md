---
title: "Cards [All regions]"
url: https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions
tab: documentation
breadcrumbs: "Payments & Features > Payment Methods > Cards [All regions]"
---

# Cards [All regions]
![](https://d24lr4zqs1tgqh.cloudfront.net/b7c66eff-b463-4594-bb61-237d4ae56dc8-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** \- Product managers, business owners, and stakeholders who want to understand card payments

**Outcome** \- Understand how card payments work, the supported card networks, the regions where they are available, and the supported transaction actions (refund, void, and capture).

* * *

Card payments offer you trusted payment methods, enabling your customers to pay securely using debit and credit cards. Paymob supports card payments across major international and local schemes, delivering secure processing and high authorization rates.

![](https://d24lr4zqs1tgqh.cloudfront.net/dc5c1fcd-ff09-45ce-8ba8-c73457a72948.jpg)

![](https://d24lr4zqs1tgqh.cloudfront.net/eb2edf2a-bc11-4c2c-861f-de2da56d59d9-696d49c90e7d4e9e101be737.svg)

### Supported Card Networks

**EGY** : VISA, Mastercard, Amex

**KSA** : VISA, Mastercard, Amex, and MADA

**UAE** : VISA, Mastercard, Amex

**OMN** : VISA, Mastercard, Amex, and Omannet

![](https://d24lr4zqs1tgqh.cloudfront.net/3ca01d25-61ec-4400-b9c3-6465ce57423b-696d49c90e7d4e9e101be737.svg)

### Supported for Regions

It's supported in all regions (**EGY** , **KSA** , **UAE** , **OMN**)

![](https://d24lr4zqs1tgqh.cloudfront.net/28a6affb-359b-4378-acc2-8de817686b1e-696d49c90e7d4e9e101be737.svg)

### Card Payment Types

**Normal 3DS**

The customer completes 3D Secure authentication (e.g., a bank OTP) during checkout.

* * *

**Moto**

A transaction where the card is not physically present, typically used for back-to-back requests without customer interaction. Passes OTP and CVV.

* * *

**Card On File**

A payment using card details securely stored by the merchant after an initial transaction. Used for faster future checkouts. Passes OTP only.

* * *

**Auth/Cap (Authorization and Capture)**

A two-step process where funds are first authorized (reserved) and then later captured (settled). Commonly used when fulfilling orders takes time.

* * *

**Verification**

A transaction that validates a card's details and available balance without transferring funds or authorizing (reserving) funds. Used to check card validity before real future charges using **Moto** or **Verification**.

![](https://d24lr4zqs1tgqh.cloudfront.net/c304b0b1-bfc8-4cb2-8c7c-758cbd92b55d-696d49c90e7d4e9e101be737.svg)

### Supported Payment Actions

**Void** for all types

**Refund**(Full/Partial) for all types

**Capture**(Full/Partial) for Auth/Cap

![](https://d24lr4zqs1tgqh.cloudfront.net/66019cad-af3e-4f33-b94e-e2397c1086b7-696d49c90e7d4e9e101be737.svg)

### Supported Integration Channels

  1. [**APIs**](https://developers.paymob.com/paymob-docs/integration-paths/apis)

  2. [**Mobile SDKs**](https://developers.paymob.com/paymob-docs/integration-paths/mobile-sdks)

  3. [**Plugins**](https://developers.paymob.com/paymob-docs/integration-paths/plugins)

  4. [**Payment Links**](https://developers.paymob.com/paymob-docs/integration-paths/no-code/payment-links)

> **Info:**
> 
> The **Card** payment method can have both **test** and **Live** integration IDs.
