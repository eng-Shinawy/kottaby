---
title: "Create QuickLink"
url: https://developers.paymob.com/paymob-docs/quicklink-apis/create-quicklink
tab: developers
breadcrumbs: "QuickLink APIs > Create QuickLink"
---

# Create QuickLink
**Outcome** \- Create a QuickLink through API

* * *

### **Authorization**

You should send a valid auth token as a Bearer Token. 

> **Info:**
> 
> You can get a valid auth token by [**Authentication Request (Generate Auth Token)**](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1)

* * *

#### Common Errors

400 Bad Request

```json
{ 
    "message": "Reference ID already exists." 
}
``` 

**Solution** : Make sure to pass a unique **reference_id** each time.

**Passing Wrong Auth Token Or Not Passing Auth Token**

401 Unauthorized

```json
{ 
    "detail": "incorrect credentials" 
}
``` 

**Solution** : Make sure to pass a valid and non-expired Auth Token each time.

**Passing an expiry date in the past**

400 Bad Request

```json
{ 
    "message": "expires_at - expires_at can't be in the past.", 
    "errors": { 
        "expires_at": [ 
            "expires_at can't be in the past." 
        ] 
    } 
}
``` 

**Solution** : Make sure to pass an expiry date in the future.

**Passing an integration ID not in the same status (Test/Live) of is_live parameter**

404 Not Found

```json
{ 
    "detail": "Integration ID/Name does not exist in our system . You can find the list of Integration ID’/Names from Merchant Dashboard under Developers → Payment Integrations Tab" 
}
``` 

**Solution** : Make sure that the passed integration ID is in the same status of **is_live** parameter 

* * *

## Endpoint

`POST api/ecommerce/payment-links`

**Content-Type:** `application/form-data`

### Request headers

- `Authorization` (string) — **required** — You can get an Auth token from the Authentication Request _(example: `Bearer ZXlKaGJHY2lPaUpJxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_

### Request body

- `payment_link_image` (String) _(example: `@"/C:/Users/Dell/Desktop/Picture1.png"`)_
- `amount_cents` (String) _(example: `5500`)_
- `expires_at` (String) _(example: `2026-07-25T18:58:57`)_
- `reference_id` (String) _(example: `ABC5295296`)_
- `payment_methods` (String) _(example: `3154260`)_
- `email` (String) _(example: `test@test.com`)_
- `is_live` (String) _(example: `false`)_
- `full_name` (String) _(example: `MMMM AAAA`)_
- `phone_number` (String) _(example: `+201010101010`)_
- `description` (String) _(example: `test`)_

### Response 200

- `id` (number) _(example: `580010`)_
- `currency` (string)
- `client_info` (object)
  - `email` (string) _(example: `test@test.com`)_
  - `full_name` (string) _(example: `MMMM AAAA`)_
  - `phone_number` (string) _(example: `+201010101010`)_
- `reference_id` (string) _(example: `ABC5295296`)_
- `shorten_url` (string) _(example: `https://paymob.link/Wr2wy`)_
- `amount_cents` (number) _(example: `5500`)_
- `payment_link_image` (string) _(example: `https://acceptance-prod.s3.amazonaws.com/secureStorage/payment_link/64ce8085-dcd6-4b95-9aca-52d65aa5557c.png?AWSAcces...`)_
- `description` (string) _(example: `test`)_
- `created_at` (string) _(example: `2026-01-17T20:12:52.282814`)_
- `expires_at` (string) _(example: `2026-07-25T18:58:57`)_
- `client_url` (string) _(example: `https://accept.paymob.com/api/ecommerce/payment-links/unrestricted?token=LRR2WXFMVEUxVTh5TGZwa25qaDlUYTFnZz09X0owaklm...`)_
- `origin` (number) _(example: `2`)_
- `merchant_staff_tag` (string)
- `state` (string) _(example: `created`)_
- `paid_at` (string)
- `redirection_url` (string)
- `notification_url` (string)
- `order` (number) _(example: `453331462`)_

