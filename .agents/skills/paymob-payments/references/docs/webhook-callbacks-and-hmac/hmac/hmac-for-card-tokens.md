---
title: "HMAC Card Token Callback:"
url: https://developers.paymob.com/paymob-docs/webhook-callbacks-and-hmac/hmac/hmac-for-card-tokens
tab: developers
breadcrumbs: "Webhook (Callbacks) & HMAC > HMAC > HMAC Card Token Callback:"
---

# HMAC Card Token Callback:
**Outcome** \- Understand how to calculate the hmac value for the card token callback

* * *

### Step 1: Sort the Data Lexicographically by Key

Sort the parameters received in the callback in lexicographical order based on their keys. The keys/parameters should be in the same order as shown in the list below.

#### Shape of data received:

  - POST callbacks: data is received as a JSON object 

#### HMAC String Keys:

```plainText
card_subtype
created_at
email
id
masked_pan
merchant_id
order_id
token
``` 

### Step 2: Concatenate the Values

Concatenate the values of the keys/parameters into a single string in the same order as they are listed. This string will be used to calculate the HMAC in the next step. For example, if we consider the sample card token callback, the resultant string would look like this:

**HMAC Concatenated String:**

```plainText
MasterCard2024-11-13T12:32:23.859982test@test.com8555026xxxx-xxxx-xxxx-2346246628264064419e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab
``` 

### Step 3: Calculate the HMAC

Use your **HMAC secret** and the **SHA-512** hashing algorithm to generate an HMAC from the concatenated string.

> **Info:**
> 
> To know how to get your hmac secret, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

**HMAC Calculated Sample:**

```plainText
a32f46ddee403d2e7685fc78b3713b90f536c8411dde89e68479b8a3498a85e7e1473c924c0587b8de4807d9dc612c84e7be92dba87f76cdf2e9b6ac04dbad4d
``` 

### Step 4: Compare the Calculated HMAC

Compare the HMAC value you calculated with the `hmac` value received in the callback’s **query parameters** (e.g., `...?hmac=generated_hash`) to verify the integrity and authenticity of the data.
