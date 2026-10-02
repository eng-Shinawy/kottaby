---
title: "Create Intention"
url: https://developers.paymob.com/paymob-docs/intention-apis/create-intention
tab: developers
breadcrumbs: "Intention APIs > Create Intention"
---

# Create Intention
**Outcome** \- Create an **Intention** that will be used to complete a payment, either via APIs or through one of our UI options.

* * *

### Authorization

Add your “**secret key** “ in the authorization header preceded by the word "**Token** ".

> **Info:**
> 
> To know how to get your secret key, please check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

### Key values in the response

You'll receive a response, which is an object that represents an intention and includes all the intention details.

  - **Important parameters:** **Order ID** : Paymob order ID, which will be received in the transaction callback and can be used to correlate the transaction to the order on your system.

  - **Intention ID** : Paymob intention ID can be used to do the same as the Order ID.

  - **Client Secret** : A unique, intention-specific token used to redirect the customer to Paymob’s Unified Checkout or to render Paymob’s Pixel component.

* * *


#### Common Errors

**Using a wrong or not well-configured integration ID**

**Status Code** : 404 Not Found

```json
{
    "detail": "Integration ID/Name does not exist in our system . You can find the list of Integration ID’/Names from Merchant Dashboard under Developers → Payment Integrations Tab"
}
``` 

**Solution** : Make sure to use an integration ID that has the following criteria:

1 - Has the same status as the used secret key (Test/Live)

2 - Valid ID related to your account and for online integration.

> **Info:**
> 
> To know how to get your integration ID, please check the **Getting Integration Credentials** page.

3 - Well-configured integration ID. You can contact [**support@paymob.com**](mailto:support@paymob.com) to help with checking the integration ID configurations.

**Missing item name or amount**

**Status Code** : 400 Bad Request

```json
{
    "items": {
        "name": [
            "This field is required."
        ]
    }
}
``` 

```json
{
    "items": {
        "amount": [
            "This field is required."
        ]
    }
}
``` 

**Solution** : Make sure to include the **name** and **amount** fields in each object within the **items** array.

**Missing phone number in the billing data object**

**Status Code** : 400 Bad Request

```json
{
    "billing_data": {
        "phone_number": [
            "This field is required."
        ]
    }
}
``` 

**Solution** : Make sure to enter a phone number.

* * *

## Endpoint

`POST v1/intention/`

**Content-Type:** `application/json`

### Request headers

- `Authorization` (String) — You can get your secret key from your Dashboard _(example: `Token sk_test_626xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)_
- `Content-Type` (String) _(example: `application/json`)_

### Request body

- `amount` (number) — **required** — The total transaction amount, expressed in cents. _(example: `2000`)_
- `currency` (string) — **required** — The currency in which the transaction is processed. This must match the currency of the selected Integration ID. _(example: `EGP`)_
- `payment_methods` (array) — **required** — The Integration ID(s) used to process the payment. Values can be provided as integers (e.g., 1256) or as names enclosed in quotes (e.g., "card"). The status (Live/Test) of the provided ID(s) should match the status of the secret key used for authentication.
  - `0` (number) — you can add your integration id as well as integration name in this object _(example: `158`)_
- `items` (array)
  - `0` (object)
    - `name` (string) — **required** — The name of the item, located under the items array. The maximum allowed length is 50 characters. _(example: `Item name`)_
    - `amount` (number) — **required** — The item amount, expressed in cents and located under the items array. When multiple items are provided, the sum of all item amounts must equal the total transaction amount. _(example: `2000`)_
    - `description` (string) — A textual description of the item, located under the items array. The maximum allowed length is 255 characters. _(example: `Item description`)_
    - `quantity` (number) — The number of units for the item, located under the items array. _(example: `1`)_
- `billing_data` (object)
  - `apartment` (string) _(example: `dumy`)_
  - `first_name` (string) — **required** — The customer’s first name, located under the billing_data object. The maximum allowed length is 50 characters. _(example: `ala`)_
  - `last_name` (string) — **required** — The customer’s last name, located under the billing_data object. The maximum allowed length is 50 characters. _(example: `zain`)_
  - `street` (string) _(example: `dumy`)_
  - `building` (string) _(example: `dumy`)_
  - `phone_number` (string) _(example: `+92345xxxxxxxx`)_
  - `city` (string) _(example: `dumy`)_
  - `country` (string) — The customer’s country name, located under the billing_data object. _(example: `dumy`)_
  - `email` (string) — **required** — The customer’s email address, located under the billing_data object. _(example: `ali@gmail.com`)_
  - `floor` (string) _(example: `dumy`)_
  - `state` (string) _(example: `dumy`)_
- `extras` (object) — A set of additional custom parameters provided by the merchant. These values are returned in callbacks under the payment key claims object.
  - `ee` (number) — **Customized parameter**, you can change the key and the value according to your need. _(example: `22`)_
- `special_reference` (string) — A unique reference associated with the transaction or order, returned in the transaction callback under merchant_order_id. _(example: `phe4sjw11q-1xxxxxxxxx`)_
- `expiration` (number) _(example: `3600`)_
- `notification_url` (string) — A callback URL that receives a POST request with full transaction details after the transaction succeeds or fails. Supported only with card Integration IDs.  **⚠️ Important Note** >  > The endpoint used in the notification URL will receive the transaction callback (transaction details) and the card token (for pay with saved card features) _(example: `https://webhook.site/dabe4968-5xxxxxxxxxxxxxxxxxxxxxx`)_
- `redirection_url` (string) — A URL to which the customer is redirected after the transaction completes, with transaction details included as query parameters.   **⚠️ Important Note** >  > Supported for Card and Wallet payment methods only. _(example: `https://www.google.com/`)_

### Response 201 — Payment Intention created successfully

- `payment_keys` (array)
  - `0` (object)
    - `integration` (number) _(example: `158`)_
    - `key` (string) _(example: `ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SjFjMlZ5WDJsa0lqbzBNems1TlRZc0ltRnRiM1Z1ZEY5alpXNTBjeUk2TVRBc0ltT...`)_
    - `gateway_type` (string) _(example: `MIGS`)_
    - `iframe_id` (string)
    - `order_id` (number) _(example: `265715202`)_
- `intention_order_id` (number) _(example: `265715202`)_
- `id` (string) _(example: `pi_test_bd49bb7fb4da48cfac4ec71ab4d8c433`)_
- `intention_detail` (object)
  - `amount` (number) _(example: `10`)_
  - `items` (array)
    - `0` (object)
      - `name` (string) _(example: `Item name`)_
      - `amount` (number) _(example: `5`)_
      - `description` (string) _(example: `Item description`)_
      - `quantity` (number) _(example: `1`)_
      - `image` (string)
    - `1` (object)
      - `name` (string) _(example: `Item name`)_
      - `amount` (number) _(example: `5`)_
      - `description` (string) _(example: `Item description`)_
      - `quantity` (number) _(example: `1`)_
      - `image` (string)
  - `currency` (string) _(example: `EGP`)_
  - `billing_data` (object)
    - `apartment` (string) _(example: `dumy`)_
    - `floor` (string) _(example: `dumy`)_
    - `first_name` (string) _(example: `Andrea`)_
    - `last_name` (string) _(example: `Nicolas`)_
    - `street` (string) _(example: `dumy`)_
    - `building` (string) _(example: `dumy`)_
    - `phone_number` (string) _(example: `+201010101010`)_
    - `shipping_method` (string)
    - `city` (string) _(example: `dumy`)_
    - `country` (string) _(example: `dumy`)_
    - `state` (string) _(example: `dumy`)_
    - `email` (string) _(example: `test@test.com`)_
    - `postal_code` (string)
- `client_secret` (string) _(example: `egy_csk_test_94042f793419c5a0f14a4cadfda9d626`)_
- `payment_methods` (array)
  - `0` (object)
    - `integration_id` (number) _(example: `4345907`)_
    - `alias` (string)
    - `name` (string) _(example: `CardF`)_
    - `method_type` (string) _(example: `online`)_
    - `currency` (string) _(example: `EGP`)_
    - `live` (boolean) _(example: `false`)_
    - `use_cvc_with_moto` (boolean) _(example: `false`)_
- `special_reference` (string) _(example: `phe4sjw111q-11221-221`)_
- `extras` (object)
  - `creation_extras` (object)
    - `ee` (number) _(example: `22`)_
  - `confirmation_extras` (string)
- `confirmed` (boolean) _(example: `false`)_
- `status` (string) _(example: `intended`)_
- `created` (string) _(example: `2024-11-18T13:42:08.456634`)_
- `card_detail` (string)
- `card_tokens` (array)
- `object` (string) _(example: `paymentintention`)_

