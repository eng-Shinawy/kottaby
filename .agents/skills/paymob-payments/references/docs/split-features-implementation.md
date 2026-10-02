---
title: "Split Features Implementation"
url: https://developers.paymob.com/paymob-docs/split-features-implementation
tab: developers
breadcrumbs: "Split Features Implementation"
---

# Split Features Implementation
**Outcome** \- Implement Split Payment and Split Amount using the Intention Creation API, and explain how each split type is represented in the payment request.

* * *

Split Features are implemented during **payment intention creation**. Both **Split Payment** and **Split Amount** are configured by adding specific parameters to the [**Create Intention API request.**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

The checkout experience, payment method selection, and confirmation flow remain unchanged. The split logic is handled internally by Paymob based on the parameters you provide.

> **Warning:**
> 
> Each feature will require configuration on your account from our side, so if you want any of them, please contact [**support@paymob.com**](mailto:support@paymob.com)

## Split Amount

### Request Body

Below are the parameters related to the **Split Amount** ; other parameters are explained in the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

Title

Description

Title

**Field**| **Description**| **Mandatory**  
---|---|---  
  
Split Amounts(split_amounts)| An array of objects, each of which represents one sub-split amount| Yes  
  
```json
"split_amounts": [
        {
            "mid": {{connected_MID1}},
            "amount_cents": {{splitted_amount1}},
            "description": "{{description1}}"
        },
        {
            "mid": {{connected_MID2}},
            "amount_cents": {{splitted_amount2}},
            "description": "{{description2}}"
        }
    ]
``` 

## Split Payment

### Request Body

Below are the parameters related to the **Split Payment** ; other parameters are explained in the [**Create Intention API documentation**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

Title

Description

Title

**Field**| **Description**| **Mandatory**  
---|---|---  
  
Split Payment Methods(split_payment_methods)| An array of integers will contain an Auth Integration ID that will be used for split.| Yes  
  
```json
"split_payment_methods": [
    {{auth_integration_id}}
]
``` 

### Callback

Below is a sample callback request sent to your configured **Processed Callback URL**.

The callback includes an array of transactions. For **each sub-payment** , two transactions are returned:

  - **Authorization (Auth)**

  - **Capture**

This means the total number of transactions in the callback is **two per sub-payment**.

> **Info:**
> 
> You can configure your endpoint in your integration ID by following the steps in the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page.

```json
{
   "order_id":453550057,
   "is_split_payment":true,
   "transactions":[
      {
         "id":399618139,
         "pending":false,
         "amount_cents":500,
         "success":true,
         "is_auth":false,
         "is_capture":true,
         "is_standalone_payment":false,
         "is_voided":false,
         "is_refunded":false,
         "is_3d_secure":false,
         "integration_id":1999062,
         "profile_id":164295,
         "has_parent_transaction":true,
         "order":{
            "id":453550057,
            "created_at":"2026-01-18T08:08:55.240695",
            "delivery_needed":false,
            "merchant":{
               "id":164295,
               "created_at":"2022-03-24T20:13:47.852384",
               "phones":[
                  "+201010101011",
                  "+201010101010"
               ],
               "company_emails":[
                  "mohamedabdelsttar97@gmail.com",
                  "test@test.com"
               ],
               "company_name":"Parmagly",
               "state":"",
               "country":"EGY",
               "city":"Cairo",
               "postal_code":"",
               "street":""
            },
            "collector":null,
            "amount_cents":1000,
            "shipping_data":{
               "id":218335393,
               "first_name":"test",
               "last_name":"test",
               "street":"15 street",
               "building":"16",
               "floor":"1",
               "apartment":"NA",
               "city":"NA",
               "state":"NA",
               "country":"Egypt",
               "email":"testtest@gmail.com",
               "phone_number":"01010101010",
               "postal_code":"NA",
               "extra_description":"",
               "shipping_method":"UNK",
               "order_id":453550057,
               "order":453550057
            },
            "currency":"EGP",
            "is_payment_locked":false,
            "is_return":false,
            "is_cancel":false,
            "is_returned":false,
            "is_canceled":false,
            "merchant_order_id":null,
            "wallet_notification":null,
            "paid_amount_cents":1000,
            "notify_user_with_email":false,
            "items":[
               {
                  "name":"Item name 2",
                  "amount_cents":1000,
                  "quantity":1
               }
            ],
            "order_url":"NA",
            "commission_fees":0,
            "delivery_fees_cents":0,
            "delivery_vat_cents":0,
            "payment_method":"tbc",
            "merchant_staff_tag":null,
            "api_source":"OTHER",
            "data":{
               
            },
            "payment_status":"PAID",
            "terminal_version":null
         },
         "created_at":"2026-01-18T08:14:12.262774",
         "transaction_processed_callback_responses":[
            
         ],
         "currency":"EGP",
         "source_data":{
            "pan":"2346",
            "type":"card",
            "tenure":null,
            "sub_type":"MasterCard"
         },
         "api_source":"OTHER",
         "terminal_id":null,
         "merchant_commission":0,
         "accept_fees":0,
         "installment":null,
         "discount_details":[
            
         ],
         "is_void":false,
         "is_refund":false,
         "data":{
            "klass":"MigsPayment",
            "amount":500.0,
            "acs_eci":"",
            "message":"Approved",
            "batch_no":20260118,
            "card_num":"512345xxxxxx2346",
            "currency":"EGP",
            "merchant":"TESTMERCH_AUS_2P",
            "card_type":"MASTERCARD",
            "created_at":"2026-01-18T06:14:13.475067",
            "migs_order":{
               "id":"453550057-399617899",
               "amount":5.0,
               "status":"CAPTURED",
               "currency":"EGP",
               "reference":"_399617899_453",
               "chargeback":{
                  "amount":0,
                  "currency":"EGP"
               },
               "creationTime":"2026-01-18T06:12:01.894Z",
               "merchantAmount":5.0,
               "lastUpdatedTime":"2026-01-18T06:14:13.307Z",
               "merchantCurrency":"EGP",
               "totalCapturedAmount":5.0,
               "totalRefundedAmount":0.0,
               "merchantCategoryCode":"7299",
               "totalAuthorizedAmount":5.0
            },
            "order_info":"453550057-399617899",
            "receipt_no":"601806006448",
            "migs_result":"SUCCESS",
            "secure_hash":"",
            "authorize_id":"006448",
            "transaction_no":"123456789",
            "avs_result_code":"",
            "captured_amount":5.0,
            "refunded_amount":0.0,
            "merchant_txn_ref":"399618139",
            "migs_transaction":{
               "id":"399618139",
               "stan":"333047",
               "type":"CAPTURE",
               "amount":5.0,
               "source":"INTERNET",
               "receipt":"601806006448",
               "acquirer":{
                  "id":"BMNF_S2I",
                  "date":"0118",
                  "batch":20260118,
                  "timeZone":"+0200",
                  "merchantId":"MERCH_AUS_2P",
                  "transactionId":"123456789",
                  "settlementDate":"2026-01-18"
               },
               "currency":"EGP",
               "terminal":"BMNF0578",
               "reference":"_399618139",
               "authorizationCode":"006448"
            },
            "acq_response_code":"00",
            "authorised_amount":5.0,
            "txn_response_code":"APPROVED",
            "avs_acq_response_code":"00",
            "gateway_integration_pk":1999062
         },
         "is_hidden":false,
         "payment_key_claims":null,
         "error_occured":false,
         "is_live":false,
         "other_endpoint_reference":null,
         "refunded_amount_cents":0,
         "source_id":-1,
         "is_captured":false,
         "captured_amount":0,
         "merchant_staff_tag":null,
         "updated_at":"2026-01-18T08:14:13.480424",
         "is_settled":false,
         "bill_balanced":false,
         "is_bill":false,
         "owner":302852,
         "parent_transaction":399617899,
         "hmac":"c04cc61424f704ca64541d0aa1b8950f249be7cad5e8145a74b8cfb12c1b5d9a9a8cc3d0abde9b09346fbc2dccf3e6e68719c5bc19abca79cc8dca6a1331d36c"
      },
      {
         "id":399617899,
         "pending":false,
         "amount_cents":500,
         "success":true,
         "is_auth":true,
         "is_capture":false,
         "is_standalone_payment":true,
         "is_voided":false,
         "is_refunded":false,
         "is_3d_secure":true,
         "integration_id":1999062,
         "profile_id":164295,
         "has_parent_transaction":false,
         "order":{
            "id":453550057,
            "created_at":"2026-01-18T08:08:55.240695",
            "delivery_needed":false,
            "merchant":{
               "id":164295,
               "created_at":"2022-03-24T20:13:47.852384",
               "phones":[
                  "+201010101011",
                  "+201010101010"
               ],
               "company_emails":[
                  "mohamedabdelsttar97@gmail.com",
                  "test@test.com"
               ],
               "company_name":"Parmagly",
               "state":"",
               "country":"EGY",
               "city":"Cairo",
               "postal_code":"",
               "street":""
            },
            "collector":null,
            "amount_cents":1000,
            "shipping_data":{
               "id":218335393,
               "first_name":"test",
               "last_name":"test",
               "street":"15 street",
               "building":"16",
               "floor":"1",
               "apartment":"NA",
               "city":"NA",
               "state":"NA",
               "country":"Egypt",
               "email":"testtest@gmail.com",
               "phone_number":"01010101010",
               "postal_code":"NA",
               "extra_description":"",
               "shipping_method":"UNK",
               "order_id":453550057,
               "order":453550057
            },
            "currency":"EGP",
            "is_payment_locked":false,
            "is_return":false,
            "is_cancel":false,
            "is_returned":false,
            "is_canceled":false,
            "merchant_order_id":null,
            "wallet_notification":null,
            "paid_amount_cents":1000,
            "notify_user_with_email":false,
            "items":[
               {
                  "name":"Item name 2",
                  "amount_cents":1000,
                  "quantity":1
               }
            ],
            "order_url":"NA",
            "commission_fees":0,
            "delivery_fees_cents":0,
            "delivery_vat_cents":0,
            "payment_method":"tbc",
            "merchant_staff_tag":null,
            "api_source":"OTHER",
            "data":{
               
            },
            "payment_status":"PAID",
            "terminal_version":null
         },
         "created_at":"2026-01-18T08:11:42.794271",
         "transaction_processed_callback_responses":[
            
         ],
         "currency":"EGP",
         "source_data":{
            "pan":"2346",
            "type":"card",
            "tenure":null,
            "sub_type":"MasterCard"
         },
         "api_source":"IFRAME",
         "terminal_id":null,
         "merchant_commission":0,
         "accept_fees":0,
         "installment":null,
         "discount_details":[
            
         ],
         "is_void":false,
         "is_refund":false,
         "data":{
            "klass":"MigsPayment",
            "amount":500.0,
            "acs_eci":"02",
            "message":"Approved",
            "batch_no":20260118,
            "card_num":"512345xxxxxx2346",
            "currency":"EGP",
            "merchant":"TESTMERCH_AUS_2P",
            "card_type":"MASTERCARD",
            "created_at":"2026-01-18T06:12:07.996712",
            "migs_order":{
               "id":"453550057-399617899",
               "amount":5.0,
               "status":"AUTHORIZED",
               "currency":"EGP",
               "reference":"_399617899_453",
               "chargeback":{
                  "amount":0,
                  "currency":"EGP"
               },
               "description":"PAYMOB Parmagly",
               "creationTime":"2026-01-18T06:12:01.894Z",
               "merchantAmount":5.0,
               "lastUpdatedTime":"2026-01-18T06:12:07.800Z",
               "merchantCurrency":"EGP",
               "acceptPartialAmount":false,
               "totalCapturedAmount":0.0,
               "totalRefundedAmount":0.0,
               "authenticationStatus":"AUTHENTICATION_SUCCESSFUL",
               "merchantCategoryCode":"7299",
               "totalAuthorizedAmount":5.0
            },
            "order_info":"453550057-399617899",
            "receipt_no":"601806006448",
            "migs_result":"SUCCESS",
            "secure_hash":"",
            "authorize_id":"006448",
            "transaction_no":"123456789",
            "avs_result_code":"",
            "captured_amount":0.0,
            "refunded_amount":0.0,
            "merchant_txn_ref":"399617899",
            "migs_transaction":{
               "id":"399617899",
               "stan":"6448",
               "type":"AUTHORIZATION",
               "amount":5.0,
               "source":"INTERNET",
               "receipt":"601806006448",
               "acquirer":{
                  "id":"BMNF_S2I",
                  "date":"0118",
                  "batch":20260118,
                  "merchantId":"MERCH_AUS_2P",
                  "transactionId":"123456789"
               },
               "currency":"EGP",
               "terminal":"BMNF0577",
               "reference":"_399617899",
               "authorizationCode":"006448",
               "authenticationStatus":"AUTHENTICATION_SUCCESSFUL"
            },
            "acq_response_code":"00",
            "authorised_amount":5.0,
            "txn_response_code":"APPROVED",
            "avs_acq_response_code":"00",
            "gateway_integration_pk":1999062
         },
         "is_hidden":false,
         "payment_key_claims":{
            "extra":{
               "NID":"2970874765694775",
               "merchant_order_id":null
            },
            "user_id":302852,
            "currency":"EGP",
            "order_id":453550057,
            "created_by":302852,
            "is_partner":false,
            "amount_cents":1000,
            "billing_data":{
               "city":"NA",
               "email":"testtest@gmail.com",
               "floor":"1",
               "state":"NA",
               "street":"15 street",
               "country":"Egypt",
               "building":"16",
               "apartment":"NA",
               "last_name":"test",
               "first_name":"test",
               "postal_code":"NA",
               "phone_number":"01010101010",
               "extra_description":"NA"
            },
            "redirect_url":"https://accept.paymob.com/unifiedcheckout/payment-status?payment_token=ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SjFjMlZ5WDJsa0lqb3pNREk0TlRJc0ltRnRiM1Z1ZEY5alpXNTBjeUk2TVRBd01Dd2lZM1Z5Y21WdVkza2lPaUpGUjFBaUxDSnBiblJsWjNKaGRHbHZibDlwWkNJNk1UazVPVEEyTWl3aWIzSmtaWEpmYVdRaU9qUTFNelUxTURBMU55d2lZbWxzYkdsdVoxOWtZWFJoSWpwN0ltWnBjbk4wWDI1aGJXVWlPaUowWlhOMElpd2liR0Z6ZEY5dVlXMWxJam9pZEdWemRDSXNJbk4wY21WbGRDSTZJakUxSUhOMGNtVmxkQ0lzSW1KMWFXeGthVzVuSWpvaU1UWWlMQ0ptYkc5dmNpSTZJakVpTENKaGNHRnlkRzFsYm5RaU9pSk9RU0lzSW1OcGRIa2lPaUpPUVNJc0luTjBZWFJsSWpvaVRrRWlMQ0pqYjNWdWRISjVJam9pUldkNWNIUWlMQ0psYldGcGJDSTZJblJsYzNSMFpYTjBRR2R0WVdsc0xtTnZiU0lzSW5Cb2IyNWxYMjUxYldKbGNpSTZJakF4TURFd01UQXhNREV3SWl3aWNHOXpkR0ZzWDJOdlpHVWlPaUpPUVNJc0ltVjRkSEpoWDJSbGMyTnlhWEIwYVc5dUlqb2lUa0VpZlN3aWJHOWphMTl2Y21SbGNsOTNhR1Z1WDNCaGFXUWlPbVpoYkhObExDSmxlSFJ5WVNJNmV5Sk9TVVFpT2lJeU9UY3dPRGMwTnpZMU5qazBOemMxSWl3aWJXVnlZMmhoYm5SZmIzSmtaWEpmYVdRaU9tNTFiR3g5TENKemFXNW5iR1ZmY0dGNWJXVnVkRjloZEhSbGJYQjBJanBtWVd4elpTd2lZM0psWVhSbFpGOWllU0k2TXpBeU9EVXlMQ0pwYzE5d1lYSjBibVZ5SWpwbVlXeHpaU3dpYm1WNGRGOXdZWGx0Wlc1MFgybHVkR1Z1ZEdsdmJpSTZJbkJwWDNSbGMzUmZOV1EzTldSa1pXUmpPVE13TkRjME5qazBZMkZoWWpNMFpETXlaVFkwWW1FaUxDSnpjR3hwZEY5d1lYbHRaVzUwWDIxbGRHaHZaSE1pT2xzeE9UazVNRFl5WFgwLnpNTmdweVJWWDZMNWl4eEtZZGptRXVHTzhhZlNyV2w1Wk1ENHBFdzNsX0VPdWE0YzBWOC1vNmFRZEs0bkg1TGFtSUprcE9KYzNneW5weU5QZmV5WEVn&trx_id=399617899",
            "integration_id":1999062,
            "lock_order_when_paid":false,
            "split_payment_methods":[
               1999062
            ],
            "next_payment_intention":"pi_test_5d75ddedc930474694caab34d32e64ba",
            "single_payment_attempt":false
         },
         "error_occured":false,
         "is_live":false,
         "other_endpoint_reference":null,
         "refunded_amount_cents":0,
         "source_id":-1,
         "is_captured":true,
         "captured_amount":500,
         "merchant_staff_tag":null,
         "updated_at":"2026-01-18T08:14:13.477801",
         "is_settled":false,
         "bill_balanced":false,
         "is_bill":false,
         "owner":302852,
         "parent_transaction":null,
         "hmac":"db615e406e32d30ca22d3ce48aeb7f9ff98b35997f6cf73fe887664be3cb468ca0ce2d8a72b385df5a4ae03638ae6067d3883fd120966fce13fd69daefd48d2d"
      },
      {
         "id":399618134,
         "pending":false,
         "amount_cents":500,
         "success":true,
         "is_auth":false,
         "is_capture":true,
         "is_standalone_payment":false,
         "is_voided":false,
         "is_refunded":false,
         "is_3d_secure":false,
         "integration_id":1999062,
         "profile_id":164295,
         "has_parent_transaction":true,
         "order":{
            "id":453550057,
            "created_at":"2026-01-18T08:08:55.240695",
            "delivery_needed":false,
            "merchant":{
               "id":164295,
               "created_at":"2022-03-24T20:13:47.852384",
               "phones":[
                  "+201010101011",
                  "+201010101010"
               ],
               "company_emails":[
                  "mohamedabdelsttar97@gmail.com",
                  "test@test.com"
               ],
               "company_name":"Parmagly",
               "state":"",
               "country":"EGY",
               "city":"Cairo",
               "postal_code":"",
               "street":""
            },
            "collector":null,
            "amount_cents":1000,
            "shipping_data":{
               "id":218335393,
               "first_name":"test",
               "last_name":"test",
               "street":"15 street",
               "building":"16",
               "floor":"1",
               "apartment":"NA",
               "city":"NA",
               "state":"NA",
               "country":"Egypt",
               "email":"testtest@gmail.com",
               "phone_number":"01010101010",
               "postal_code":"NA",
               "extra_description":"",
               "shipping_method":"UNK",
               "order_id":453550057,
               "order":453550057
            },
            "currency":"EGP",
            "is_payment_locked":false,
            "is_return":false,
            "is_cancel":false,
            "is_returned":false,
            "is_canceled":false,
            "merchant_order_id":null,
            "wallet_notification":null,
            "paid_amount_cents":1000,
            "notify_user_with_email":false,
            "items":[
               {
                  "name":"Item name 2",
                  "amount_cents":1000,
                  "quantity":1
               }
            ],
            "order_url":"NA",
            "commission_fees":0,
            "delivery_fees_cents":0,
            "delivery_vat_cents":0,
            "payment_method":"tbc",
            "merchant_staff_tag":null,
            "api_source":"OTHER",
            "data":{
               
            },
            "payment_status":"PAID",
            "terminal_version":null
         },
         "created_at":"2026-01-18T08:14:10.912635",
         "transaction_processed_callback_responses":[
            
         ],
         "currency":"EGP",
         "source_data":{
            "pan":"2346",
            "type":"card",
            "tenure":null,
            "sub_type":"MasterCard"
         },
         "api_source":"OTHER",
         "terminal_id":null,
         "merchant_commission":0,
         "accept_fees":0,
         "installment":null,
         "discount_details":[
            
         ],
         "is_void":false,
         "is_refund":false,
         "data":{
            "klass":"MigsPayment",
            "amount":500.0,
            "acs_eci":"",
            "message":"Approved",
            "batch_no":20260118,
            "card_num":"512345xxxxxx2346",
            "currency":"EGP",
            "merchant":"TESTMERCH_AUS_2P",
            "card_type":"MASTERCARD",
            "created_at":"2026-01-18T06:14:12.219505",
            "migs_order":{
               "id":"453550057-399618094",
               "amount":5.0,
               "status":"CAPTURED",
               "currency":"EGP",
               "reference":"_399618094_453",
               "chargeback":{
                  "amount":0,
                  "currency":"EGP"
               },
               "creationTime":"2026-01-18T06:14:00.335Z",
               "merchantAmount":5.0,
               "lastUpdatedTime":"2026-01-18T06:14:12.038Z",
               "merchantCurrency":"EGP",
               "totalCapturedAmount":5.0,
               "totalRefundedAmount":0.0,
               "merchantCategoryCode":"7299",
               "totalAuthorizedAmount":5.0
            },
            "order_info":"453550057-399618094",
            "receipt_no":"601806333045",
            "migs_result":"SUCCESS",
            "secure_hash":"",
            "authorize_id":"333045",
            "transaction_no":"123456789",
            "avs_result_code":"",
            "captured_amount":5.0,
            "refunded_amount":0.0,
            "merchant_txn_ref":"399618134",
            "migs_transaction":{
               "id":"399618134",
               "stan":"14614",
               "type":"CAPTURE",
               "amount":5.0,
               "source":"INTERNET",
               "receipt":"601806333045",
               "acquirer":{
                  "id":"BMNF_S2I",
                  "date":"0118",
                  "batch":20260118,
                  "timeZone":"+0200",
                  "merchantId":"MERCH_AUS_2P",
                  "transactionId":"123456789",
                  "settlementDate":"2026-01-18"
               },
               "currency":"EGP",
               "terminal":"BMNF0573",
               "reference":"_399618134",
               "authorizationCode":"333045"
            },
            "acq_response_code":"00",
            "authorised_amount":5.0,
            "txn_response_code":"APPROVED",
            "avs_acq_response_code":"00",
            "gateway_integration_pk":1999062
         },
         "is_hidden":false,
         "payment_key_claims":null,
         "error_occured":false,
         "is_live":false,
         "other_endpoint_reference":null,
         "refunded_amount_cents":0,
         "source_id":-1,
         "is_captured":false,
         "captured_amount":0,
         "merchant_staff_tag":null,
         "updated_at":"2026-01-18T08:14:12.225703",
         "is_settled":false,
         "bill_balanced":false,
         "is_bill":false,
         "owner":302852,
         "parent_transaction":399618094,
         "hmac":"0abf79f3f36c916cfe1f73eab0894519a5c5907f05ef7df7169d74ac4c38ee742db8867f0eb3f923410a4d1c534c83ded46d9476a78ba84c3022c373d14a7347"
      },
      {
         "id":399618094,
         "pending":false,
         "amount_cents":500,
         "success":true,
         "is_auth":true,
         "is_capture":false,
         "is_standalone_payment":true,
         "is_voided":false,
         "is_refunded":false,
         "is_3d_secure":true,
         "integration_id":1999062,
         "profile_id":164295,
         "has_parent_transaction":false,
         "order":{
            "id":453550057,
            "created_at":"2026-01-18T08:08:55.240695",
            "delivery_needed":false,
            "merchant":{
               "id":164295,
               "created_at":"2022-03-24T20:13:47.852384",
               "phones":[
                  "+201010101011",
                  "+201010101010"
               ],
               "company_emails":[
                  "mohamedabdelsttar97@gmail.com",
                  "test@test.com"
               ],
               "company_name":"Parmagly",
               "state":"",
               "country":"EGY",
               "city":"Cairo",
               "postal_code":"",
               "street":""
            },
            "collector":null,
            "amount_cents":1000,
            "shipping_data":{
               "id":218335393,
               "first_name":"test",
               "last_name":"test",
               "street":"15 street",
               "building":"16",
               "floor":"1",
               "apartment":"NA",
               "city":"NA",
               "state":"NA",
               "country":"Egypt",
               "email":"testtest@gmail.com",
               "phone_number":"01010101010",
               "postal_code":"NA",
               "extra_description":"",
               "shipping_method":"UNK",
               "order_id":453550057,
               "order":453550057
            },
            "currency":"EGP",
            "is_payment_locked":false,
            "is_return":false,
            "is_cancel":false,
            "is_returned":false,
            "is_canceled":false,
            "merchant_order_id":null,
            "wallet_notification":null,
            "paid_amount_cents":1000,
            "notify_user_with_email":false,
            "items":[
               {
                  "name":"Item name 2",
                  "amount_cents":1000,
                  "quantity":1
               }
            ],
            "order_url":"NA",
            "commission_fees":0,
            "delivery_fees_cents":0,
            "delivery_vat_cents":0,
            "payment_method":"tbc",
            "merchant_staff_tag":null,
            "api_source":"OTHER",
            "data":{
               
            },
            "payment_status":"PAID",
            "terminal_version":null
         },
         "created_at":"2026-01-18T08:13:38.716883",
         "transaction_processed_callback_responses":[
            
         ],
         "currency":"EGP",
         "source_data":{
            "pan":"2346",
            "type":"card",
            "tenure":null,
            "sub_type":"MasterCard"
         },
         "api_source":"IFRAME",
         "terminal_id":null,
         "merchant_commission":0,
         "accept_fees":0,
         "installment":null,
         "discount_details":[
            
         ],
         "is_void":false,
         "is_refund":false,
         "data":{
            "klass":"MigsPayment",
            "amount":500.0,
            "acs_eci":"02",
            "message":"Approved",
            "batch_no":20260118,
            "card_num":"512345xxxxxx2346",
            "currency":"EGP",
            "merchant":"TESTMERCH_AUS_2P",
            "card_type":"MASTERCARD",
            "created_at":"2026-01-18T06:14:04.578434",
            "migs_order":{
               "id":"453550057-399618094",
               "amount":5.0,
               "status":"AUTHORIZED",
               "currency":"EGP",
               "reference":"_399618094_453",
               "chargeback":{
                  "amount":0,
                  "currency":"EGP"
               },
               "description":"PAYMOB Parmagly",
               "creationTime":"2026-01-18T06:14:00.335Z",
               "merchantAmount":5.0,
               "lastUpdatedTime":"2026-01-18T06:14:04.394Z",
               "merchantCurrency":"EGP",
               "acceptPartialAmount":false,
               "totalCapturedAmount":0.0,
               "totalRefundedAmount":0.0,
               "authenticationStatus":"AUTHENTICATION_SUCCESSFUL",
               "merchantCategoryCode":"7299",
               "totalAuthorizedAmount":5.0
            },
            "order_info":"453550057-399618094",
            "receipt_no":"601806333045",
            "migs_result":"SUCCESS",
            "secure_hash":"",
            "authorize_id":"333045",
            "transaction_no":"123456789",
            "avs_result_code":"",
            "captured_amount":0.0,
            "refunded_amount":0.0,
            "merchant_txn_ref":"399618094",
            "migs_transaction":{
               "id":"399618094",
               "stan":"333045",
               "type":"AUTHORIZATION",
               "amount":5.0,
               "source":"INTERNET",
               "receipt":"601806333045",
               "acquirer":{
                  "id":"BMNF_S2I",
                  "date":"0118",
                  "batch":20260118,
                  "merchantId":"MERCH_AUS_2P",
                  "transactionId":"123456789"
               },
               "currency":"EGP",
               "terminal":"BMNF0571",
               "reference":"_399618094",
               "authorizationCode":"333045",
               "authenticationStatus":"AUTHENTICATION_SUCCESSFUL"
            },
            "acq_response_code":"00",
            "authorised_amount":5.0,
            "txn_response_code":"APPROVED",
            "avs_acq_response_code":"00",
            "gateway_integration_pk":1999062
         },
         "is_hidden":false,
         "payment_key_claims":{
            "extra":{
               "NID":"2970874765694775",
               "merchant_order_id":null
            },
            "user_id":302852,
            "currency":"EGP",
            "order_id":453550057,
            "created_by":302852,
            "is_partner":false,
            "amount_cents":1000,
            "billing_data":{
               "city":"NA",
               "email":"testtest@gmail.com",
               "floor":"1",
               "state":"NA",
               "street":"15 street",
               "country":"Egypt",
               "building":"16",
               "apartment":"NA",
               "last_name":"test",
               "first_name":"test",
               "postal_code":"NA",
               "phone_number":"01010101010",
               "extra_description":"NA"
            },
            "redirect_url":"https://accept.paymob.com/unifiedcheckout/payment-status?payment_token=ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SjFjMlZ5WDJsa0lqb3pNREk0TlRJc0ltRnRiM1Z1ZEY5alpXNTBjeUk2TVRBd01Dd2lZM1Z5Y21WdVkza2lPaUpGUjFBaUxDSnBiblJsWjNKaGRHbHZibDlwWkNJNk1UazVPVEEyTWl3aWIzSmtaWEpmYVdRaU9qUTFNelUxTURBMU55d2lZbWxzYkdsdVoxOWtZWFJoSWpwN0ltWnBjbk4wWDI1aGJXVWlPaUowWlhOMElpd2liR0Z6ZEY5dVlXMWxJam9pZEdWemRDSXNJbk4wY21WbGRDSTZJakUxSUhOMGNtVmxkQ0lzSW1KMWFXeGthVzVuSWpvaU1UWWlMQ0ptYkc5dmNpSTZJakVpTENKaGNHRnlkRzFsYm5RaU9pSk9RU0lzSW1OcGRIa2lPaUpPUVNJc0luTjBZWFJsSWpvaVRrRWlMQ0pqYjNWdWRISjVJam9pUldkNWNIUWlMQ0psYldGcGJDSTZJblJsYzNSMFpYTjBRR2R0WVdsc0xtTnZiU0lzSW5Cb2IyNWxYMjUxYldKbGNpSTZJakF4TURFd01UQXhNREV3SWl3aWNHOXpkR0ZzWDJOdlpHVWlPaUpPUVNJc0ltVjRkSEpoWDJSbGMyTnlhWEIwYVc5dUlqb2lUa0VpZlN3aWJHOWphMTl2Y21SbGNsOTNhR1Z1WDNCaGFXUWlPbVpoYkhObExDSmxlSFJ5WVNJNmV5Sk9TVVFpT2lJeU9UY3dPRGMwTnpZMU5qazBOemMxSWl3aWJXVnlZMmhoYm5SZmIzSmtaWEpmYVdRaU9tNTFiR3g5TENKemFXNW5iR1ZmY0dGNWJXVnVkRjloZEhSbGJYQjBJanBtWVd4elpTd2lZM0psWVhSbFpGOWllU0k2TXpBeU9EVXlMQ0pwYzE5d1lYSjBibVZ5SWpwbVlXeHpaU3dpYm1WNGRGOXdZWGx0Wlc1MFgybHVkR1Z1ZEdsdmJpSTZJbkJwWDNSbGMzUmZOV1EzTldSa1pXUmpPVE13TkRjME5qazBZMkZoWWpNMFpETXlaVFkwWW1FaUxDSnpjR3hwZEY5d1lYbHRaVzUwWDIxbGRHaHZaSE1pT2xzeE9UazVNRFl5WFgwLnpNTmdweVJWWDZMNWl4eEtZZGptRXVHTzhhZlNyV2w1Wk1ENHBFdzNsX0VPdWE0YzBWOC1vNmFRZEs0bkg1TGFtSUprcE9KYzNneW5weU5QZmV5WEVn&trx_id=399618094",
            "integration_id":1999062,
            "lock_order_when_paid":false,
            "split_payment_methods":[
               1999062
            ],
            "next_payment_intention":"pi_test_5d75ddedc930474694caab34d32e64ba",
            "single_payment_attempt":false
         },
         "error_occured":false,
         "is_live":false,
         "other_endpoint_reference":null,
         "refunded_amount_cents":0,
         "source_id":-1,
         "is_captured":true,
         "captured_amount":500,
         "merchant_staff_tag":null,
         "updated_at":"2026-01-18T08:14:12.222190",
         "is_settled":false,
         "bill_balanced":false,
         "is_bill":false,
         "owner":302852,
         "parent_transaction":null,
         "hmac":"1a51585b4c249e9eacec8a6140ebac1561e16c22b9a434db4f50cdad430579625f1ed07dc1661fc4db9c0b529b5e95610899edd955372b80fae934813a18952d"
      }
   ]
}
``` 

### HMAC calculation

The HMAC calculation method is similar to the one followed for normal transactions, but each transaction in the array received in the callback has its own **hmac** parameter, which will be used to compare with after following the guide in the [**HMAC documentation**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac).
