---
title: "Overview"
url: https://developers.paymob.com/paymob-docs/webhook-callbacks-and-hmac/overview
tab: developers
breadcrumbs: "Webhook (Callbacks) & HMAC > Overview"
---

# Overview
**Outcome** \- Understand the different types of Paymob callbacks, their purposes, and HMAC calculation.

* * *

### Definition 

**Transaction callbacks** are mechanisms used by Paymob to notify your system about payment-related events and transaction statuses. They ensure your platform stays in sync with what happens during and after a customer completes a payment.

### When does Paymob send the transaction callback?

Paymob sends the transaction callback only if the transaction **succeeds** or is **declined**

### Types of Transaction Callbacks

Paymob provides **two types of transaction callbacks** to keep both your system and your customers informed about payment results:

#### **Transaction Processed Callback**

Used to notify your backend system about transaction events and status changes, allowing you to update orders, trigger business logic, and keep your records in sync. 

#### **Transaction Response Callback**

Used to redirect the customer back to your platform after payment, so you can display the payment result and guide the next user action.

Each callback serves a different purpose and is designed to support both **system-level handling** and **customer-facing communication**. Detailed technical implementation for each callback is covered in the following sub-page.

### Webhook Testing Tool

We provide a dedicated tool to help you test webhooks. For detailed instructions and usage, please refer to the [**Webhook Testing Tool**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/webhook-testing-tool) page.
