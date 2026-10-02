---
title: "Update Intention"
url: https://developers.paymob.com/paymob-docs/intention-apis/update-intention
tab: developers
breadcrumbs: "Intention APIs > Update Intention"
---

# Update Intention
**Outcome** \- Update the (**amount, payment_methods, items** ,**billing_data, special_reference,** and **notification_url**) of an existing intention.

* * *

### Authorization

Add your “**secret key** “ in the authorization header preceded by the word "**Token** ".

> **Info:**
> 
> To know how to get your secret key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

> **Warning:**
> 
> Important Notes:
> 
> The endpoint used in the notification URL will receive the transaction callback (transaction details) and the card token (for pay with saved card features)

* * *

#### Common errors

### Missing Accept Order ID parameter

**Status Code** : 400 Bad Request

```json
{
  accept_order_id": [
          "This field is required."
      ]
  }
    {
  accept_order_id": [
          "This field is required."
      ]
  }
``` 

**Solution:** Make sure to pass the order ID related to the client secret you passed as a path parameter

* * *

## Endpoint

`PUT v1/intention/{client_secret}/`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (string) — **required** — You can get your secret key from your Dashboard _(example: `Token sk_test_xxxxxxxxxxxxxxxxxxxx`)_

### Path parameters

- `client_secret` (string) — **required** — Client secret token for completing the payment

### Request body

- `amount` (number) — **required** — The item amount, expressed in cents and located under the items array. When multiple items are provided, the sum of all item amounts must equal the total transaction amount. _(example: `2000`)_
- `payment_methods` (array)
  - `0` (number) _(example: `159`)_
- `items` (array) — List of items in the order
  - `0` (object) — List of items in the order
    - `name` (string) — **required** — The name of the item, located under the items array. The maximum allowed length is 50 characters. _(example: `Item name`)_
    - `amount` (number) — **required** — The item amount, expressed in cents and located under the items array. When multiple items are provided, the sum of all item amounts must equal the total transaction amount. _(example: `2000`)_
    - `description` (string) — A textual description of the item, located under the items array. The maximum allowed length is 255 characters. _(example: `Item description`)_
    - `quantity` (number) — The number of units for the item, located under the items array. _(example: `1`)_
- `billing_data` (object) — Customer billing information
  - `apartment` (string) — Apartment number
  - `first_name` (string) — **required** — The customer’s first name, located under the billing_data object. The maximum allowed length is 50 characters. _(example: `ala`)_
  - `last_name` (string) — **required** — The customer’s last name, located under the billing_data object. The maximum allowed length is 50 characters. _(example: `zain`)_
  - `street` (string) — Street address
  - `building` (string) — Building name or number
  - `phone_number` (string) — **required** — The customer’s phone number, located under the billing_data object. Both international and domestic formats are supported, including alpha-2 and standard numeric country codes. _(example: `+92345xxxxxxxx`)_
  - `city` (string) — City name
  - `country` (string) — The customer’s country name, located under the billing_data object.
  - `email` (string) — **required** — The customer’s email address, located under the billing_data object. _(example: `ali@gmail.com`)_
  - `floor` (string) — Floor number
  - `state` (string) — State or province
- `special_reference` (string) — A unique reference associated with the transaction or order, returned in the transaction callback under merchant_order_id. _(example: `phe4sjw11q-1xxxxxxxxx`)_
- `expiration` (number) _(example: `3600`)_
- `notification_url` (string) — A callback URL that receives a POST request with full transaction details after the transaction succeeds or fails. Supported only with card Integration IDs. This endpoint _(example: `https://webhook.site/dabe4968-5xxxxxxxxxxxxxxxxxxxxxx`)_
- `redirection_url` (string) — A URL to which the customer is redirected after the transaction completes, with transaction details included as query parameters. Supported only with card and wallet payment methods. _(example: `https://www.google.com/`)_

### Response 201 — Payment Intention created successfully

- `payment_keys` (array)
  - `0` (array)
    - `integration` (number) _(example: `158`)_
    - `key` (string) _(example: `ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SjFjMlZ5WDJsa0lqbzBNems1TlRZc0ltRnRiM1Z1ZEY5alpXNTBjeUk2TVRBc0ltT...`)_
    - `gateway_type` (string) _(example: `MIGS`)_
    - `iframe_id` (string)
    - `order_id` (number) — The unique order identifier _(example: `265715202`)_
- `intention_order_id` (number) _(example: `265715202`)_
- `id` (string) — Unique identifier for the transaction _(example: `pi_test_bd49bb7fb4da48cfac4ec71ab4d8c433`)_
- `intention_detail` (object)
  - `amount` (number) — Transaction amount in cents _(example: `10`)_
  - `items` (array) — List of items in the order
    - `0` (array) — List of items in the order
      - `name` (string) — Name of the item _(example: `Item name`)_
      - `amount` (number) — Transaction amount in cents _(example: `5`)_
      - `description` (string) — Description of the item _(example: `Item description`)_
      - `quantity` (number) — Quantity of items _(example: `1`)_
      - `image` (string)
  - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
  - `billing_data` (object) — Customer billing information
    - `apartment` (string) — Apartment number
    - `floor` (string) — Floor number
    - `first_name` (string) — Customer first name _(example: `Andrea`)_
    - `last_name` (string) — Customer last name _(example: `Nicolas`)_
    - `street` (string) — Street address
    - `building` (string) — Building name or number
    - `phone_number` (string) — Customer phone number _(example: `+201010101010`)_
    - `shipping_method` (string)
    - `city` (string) — City name
    - `country` (string) — Country name
    - `state` (string) — State or province
    - `email` (string) — Customer email address _(example: `test@test.com`)_
    - `postal_code` (string) — Postal or ZIP code
- `client_secret` (string) — Client secret token for completing the payment _(example: `egy_csk_test_94042f793419c5a0f14a4cadfda9d626`)_
- `payment_methods` (array) — Available payment methods for this transaction
  - `0` (array) — Available payment methods for this transaction
    - `integration_id` (number) — The integration ID used for this transaction _(example: `4345907`)_
    - `alias` (string)
    - `name` (string) — Name of the item _(example: `CardF`)_
    - `method_type` (string) _(example: `online`)_
    - `currency` (string) — Currency code (e.g., EGP, USD) _(example: `EGP`)_
    - `live` (boolean)
    - `use_cvc_with_moto` (boolean)
- `special_reference` (string) — Special reference identifier for merchant use _(example: `phe4sjw111q-11221-221`)_
- `extras` (object) — Additional custom data
  - `creation_extras` (object) — Custom data provided during creation
    - `ee` (number) _(example: `22`)_
  - `confirmation_extras` (string) — Custom data provided during confirmation
- `confirmed` (boolean) — Indicates if the transaction has been confirmed
- `status` (string) — Current status of the record _(example: `intended`)_
- `created` (string) _(example: `2024-11-18T13:42:08.456634`)_
- `card_detail` (string) — Card details used for the transaction
- `card_tokens` (array) — List of saved card tokens
- `object` (string) — Type of object returned _(example: `paymentintention`)_

