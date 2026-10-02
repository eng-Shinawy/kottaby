---
title: "HMAC"
url: https://developers.paymob.com/paymob-docs/webhook-callbacks-and-hmac/hmac
tab: developers
breadcrumbs: "Webhook (Callbacks) & HMAC > HMAC"
---

# HMAC
**Outcome** -Understand the HMAC calculation mechanism.

* * *

### What is HMAC Authentication?

**HMAC (Hash-based Message Authentication Code)** is a widely used cryptographic technique designed to ensure both the integrity and authenticity of a message. It combines a cryptographic hash function (such as SHA-512) with a secret key and a string of data to produce a unique signature, known as an HMAC. This signature serves as a guarantee that the message has not been altered during transmission and confirms the identity of the sender.

Whenever you receive a callback from Accept, even if it's ([Processed, Response](https://developers.paymob.com/paymob-docs/webhook-callbacks-and-hmac/transaction-callbacks), or **Card token**), it includes an **HMAC** query parameter. You should calculate the HMAC using the received data and compare it with the provided value to verify the callback’s authenticity.

### Calculation steps guidelines

At a high level, HMAC authentication works as follows:

  - Paymob sends transaction data along with an HMAC value.

  - You recreate this HMAC using the received data and your hmac secret key.

  - You compare your generated HMAC with the one received.

  - If both values match, the callback is verified and trusted.

This mechanism ensures that your system only processes valid callbacks sent by Paymob.
