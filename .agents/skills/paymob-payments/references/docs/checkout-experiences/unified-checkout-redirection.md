---
title: "Unified Checkout (Redirection)"
url: https://developers.paymob.com/paymob-docs/checkout-experiences/unified-checkout-redirection
tab: developers
breadcrumbs: "Checkout Experiences > Unified Checkout (Redirection)"
---

# Unified Checkout (Redirection)
**Outcome** \- Redirect the customers to Paymob's Unified Checkout to process and complete the payment, and customize the Unified Checkout.  
  
* * *

### Query Parameters 

#### Client Secret

> **Info:**
> 
> You can get a client secret by calling the [**Create Intention API request**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention).

#### Public Key

> **Info:**
> 
> To know how to get your public key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

### Test Credentials

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.

## Endpoint

`GET unifiedcheckout/`

### Query parameters

- `publicKey` (String) — **required** — You can get your public key from your Dashboard _(example: `{your_public_key}`)_
- `clientSecret` (String) — **required** — A unique, intention-specific token used to redirect the customer to Paymob’s Unified Checkout or to render Paymob’s Pixel component. _(example: `{the_client_secret}`)_

