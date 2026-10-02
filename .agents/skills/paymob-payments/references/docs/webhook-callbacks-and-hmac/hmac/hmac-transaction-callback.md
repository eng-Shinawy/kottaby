---
title: "HMAC Transaction Callback"
url: https://developers.paymob.com/paymob-docs/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback
tab: developers
breadcrumbs: "Webhook (Callbacks) & HMAC > HMAC > HMAC Transaction Callback"
---

# HMAC Transaction Callback
**Outcome** \- Understand how to calculate the hmac value for the transaction callbacks (Processed and Response)

* * *

### Step 1: Sort the Data Lexicographically by Key

Sort the parameters received in the callback in lexicographical order based on their keys. The keys/parameters should be in the same order as shown in the list below.

#### Shape of data received:

  - POST callbacks: data is received as a JSON object 

  - GET callbacks: data is received as query parameters

You can check [**the callbacks guide**](https://developers.paymob.com/paymob-docs/webhook-callbacks-and-hmac/transaction-callbacks) to know more about each type of callback.

#### HMAC String Keys:

```plainText
amount_cents
created_at
currency
error_occured
has_parent_transaction
obj.id  // for Processed (POST) | id for Response (GET)
integration_id
is_3d_secure
is_auth
is_capture
is_refunded
is_standalone_payment
is_voided
order.id  // for Processed (POST) | order_id for Response (GET) 
owner
pending
source_data.pan
source_data.sub_type
source_data.type
success
``` 

### Step 2: Concatenate the Values

Concatenate the values of the keys/parameters into a single string in the same order as they are listed. This string will be used to calculate the HMAC in the next step. For example, if we consider the sample transaction processed callback, the resultant string would look like this:

**HMAC Concatenated String:**

```plainText
1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue
``` 

### Step 3: Calculate the HMAC

Use your **HMAC secret** and the **SHA-512** hashing algorithm to generate an HMAC from the concatenated string.

> **Info:**
> 
> To know how to get your hmac secret, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

**HMAC Calculated Sample:**

```plainText
fa8ac0b7f3852e60c50e7fdd4ea5ef0bda96030c19dea1d55df8c76d6c08ab1877774662cbb049
81dc84839ad4da560bcc8cb53b8973548657f7e8f8d2e79930
``` 

### Step 4: Compare the Calculated HMAC

Compare the HMAC value you calculated with the `hmac` value received in the callback’s **query parameters** (e.g., `...?hmac=generated_hash`) to verify the integrity and authenticity of the data.
