---
title: "Pay With Saved Cards"
url: https://developers.paymob.com/paymob-docs/payments-and-features/core-features/pay-with-saved-cards
tab: documentation
breadcrumbs: "Payments & Features > Core Features > Pay With Saved Cards"
---

# Pay With Saved Cards
![](https://d24lr4zqs1tgqh.cloudfront.net/c1d995e0-79b0-457f-a997-154d2a6062e8-696e9edc0acf4f5a50bce69f.svg)

**Who is this for** \- Product managers, business owners, and stakeholders who want to **streamline the checkout process** for returning customers and increase repeat sales

**Outcome** - Understand what “Pay With Saved Cards” is, how it benefits your business and customers

* * *

### What is Pay With Saved Cards?

This feature securely stores a customer’s card information after their first successful payment. For subsequent purchases, the customer can select the saved card and pay without manually entering card details or completing full authentication flows, making the checkout process **faster and more convenient**.

### Card Types to use with

  - Normal 3DS

  - Auth

  - Card On File

  - Moto

### When to use Pay With Saved Cards

Enable this feature if your business:

  - Has **frequent returning customers**

  - Wants to **increase checkout speed**

  - Seeks to **boost repeat sales and loyalty**

### How it works

  1. **Customer saves card (First Payment):** During checkout, the customer opts to save their card for future purchases, and the merchant's system receives a token that represents the card.

  2. **Use the saved cards (Future Payments):** When the customer gets back and wants to pay with his saved card, the merchant's system should pass the card token again to Paymob, then redirect the customer to one of Paymob's UIs

  3. **Processing the Payment:** According to the [**Card Integration**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions) type used, Paymob will process the payment, applying the relevant validation and security checks before completing the transaction.

### [**Card Types to use with**](https://developers.paymob.com/paymob-docs/payments-and-features/payment-methods/cards-all-regions)

  - **Normal 3DS**

  - **Auth**

  - **Card On File**

  - **Moto**

### Technical Implementation

> **Info:**
> 
> Check the technical implementation guide in the [**Pay With Saved Cards guide**](https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/create-card-token) under the Developers Reference sections
