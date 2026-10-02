---
title: "Cancel QuickLink"
url: https://developers.paymob.com/paymob-docs/quicklink-apis/cancel-quicklink
tab: developers
breadcrumbs: "QuickLink APIs > Cancel QuickLink"
---

# Cancel QuickLink
**Outcome** \- Cancel a QuickLink through API

* * *

### **Authorization**

You should send a valid auth token as a Bearer Token. 

> **Info:**
> 
> You can get a valid auth token by [**Authentication Request (Generate Auth Token)**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1)

* * *

## Endpoint

`POST api/ecommerce/payment-links/cancel`

**Content-Type:** `application/form-data`

### Request headers

- `Authorization` (string) — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `Content-Type` (string) _(example: `application/json`)_

### Request body

- `payment_link_id` (String) _(example: `"580010"`)_

### Response 200

- `success` (boolean) _(example: `true`)_
- `message` (string) _(example: `Canceled by merchant`)_
- `payment_link_id` (number) _(example: `580010`)_

