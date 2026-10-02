---
title: "Common Issues & Inquires"
url: https://developers.paymob.com/paymob-docs/need-help/faq/common-issues-and-inquires
tab: documentation
breadcrumbs: "Need Help? > FAQ > Common Issues & Inquires"
---

# Common Issues & Inquires
![](https://d24lr4zqs1tgqh.cloudfront.net/b2951847-4380-4260-afc8-bb9d43c08ff3-696e9edc0acf4f5a50bce69f.svg)  
  
Who is this for: Everyone

Outcome: Explore common issues and most commonly raised inquiries for faster resolution.

## Common Issues

#### "Unable to authorize store ownership" in Shopify

### Description 

Facing the error “Unable to authorize store ownership” while trying to log into the Paymob Shopify app.

![](https://d24lr4zqs1tgqh.cloudfront.net/5a3d741d-8c4e-4cb8-bdb9-a92b2c3278f7.jpg)

### Solution

Log in with the correct account

  1. **Use your main account credentials** Log in using the same username and password you use to access the Paymob dashboard. 

  2. **If you’ve logged in before** Make sure to use the same credentials from your first successful login, as the app is linked to that account. 

  3. **Need to switch accounts?** Switching accounts isn’t supported directly within the app. To proceed, either: 

  4. Submit a support ticket at [**support@paymob.com**](mailto:support@paymob.com), or 

  5. Contact your account manager for assistance

#### Integration ID/Name does not exist

### Descritpion

Facing the error (Integration ID/Name does not exist in our system. You can find the list of Integration ID’/Names from Merchant Dashboard under Developers → Payment Integrations Tab) while calling the [**intention creation API request**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)

![](https://d24lr4zqs1tgqh.cloudfront.net/31da928c-10ba-40ea-89c7-e9f154d9cbe1.jpg)

### Solution

Make sure that the used integration ID meets the following **4** criteria:

  1. The integration ID related to your account.

  2. The integration ID matches the status of the used secret key (**Live** /**Test**)

  3. The integration ID is passed to the intention API as an integer, not as a string.

  4. The integration ID is well configured; if all the above steps have been followed, and you are still facing the same issue, then please contact your account manager or submit a support ticket to [**support@paymob.com**](). Be sure to include detailed information about the problem.

#### Refund Failure Error

### Description

Occurs when a refund request cannot be processed. This may be due to an insufficient account balance or other issues indicated by the error message returned on the dashboard or within the API response.

![](https://d24lr4zqs1tgqh.cloudfront.net/6f6832cf-0675-4f23-a0ab-03b639402fd7.jpg)

### Solution

Follow the steps below to troubleshoot refund issues:

  1. **Verify your balance** Ensure that your account has sufficient balance to process the refund, as insufficient funds are a common cause of failure.

  2. **Check the error message** Review the error message displayed on the dashboard or returned in the API response. This usually indicates the reason for the failure.

  3. **Handle generic error messages** If you receive a generic message such as “**Oops, something went wrong.** ”, follow these steps:

     1. Open your browser’s Developer Tools (press Ctrl _Shift_ I) and go to the Network tab.

     2. Attempt the refund again.

     3. Locate the failed request (highlighted in red) with the name refund.

     4. Capture a screenshot of the request.

     5. Copy and share the Request Headers and Response details for further investigation.

     6. In the Headers tab, find the x-paymob-id value and include it in your report.

#### "accept.paymobsolutions.com refused to connect" in Shopify

### Description

Facing the error "accept.paymobsolutions.com refused to connect" while you try to reach the Paymob shopify apps configuration on the Shopify store

![](https://d24lr4zqs1tgqh.cloudfront.net/3811fe05-2311-4703-8c65-3335391d9682.jpg)

### Solution

To successfully connect and configure the Paymob Shopify apps, please follow these steps:

  1. Log in to your**Shopify Admin Dashboard**.

  2. Go to **Settings**(located at the bottom-left corner of the dashboard).

  3. Select **Payments** from the list of settings. 

  4. Manage the desired Paymob Shopify app. 

![](https://d24lr4zqs1tgqh.cloudfront.net/f7fb1482-7644-4162-8e27-165ec77b28a3.jpg)

#### Next user doesn't exist

### Description

Facing the error "**Next user doesn't exist** " while creating a Quick Link through Paymob's dashboard

![](https://d24lr4zqs1tgqh.cloudfront.net/74c9df01-8d07-4e87-9462-f4e2a8e17413.jpg)

### Solution

Please contact your account manager or submit a support ticket to [**support@paymob.com**]() to configure your account for the new experience. Be sure to include detailed information about the problem.

#### Can't create IFrames

### Description

Occurs when a merchant requires setting up a new IFrame integration 

### Solution

We recommend using [**Unified Checkout**](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/unified-checkout-redirection), our latest checkout experience, designed to provide an improved and seamless user interface. All new merchants are encouraged to adopt this experience.

If you are an existing merchant currently using the **IFrame** integration and require a new IFrame setup, please note that this request must be handled by our team. To proceed, contact your account manager or submit a support ticket at [**support@paymob.com**](mailto:support@paymob.com).

## Common Inquiries

#### How do I set up a global account?

### Answer

Currently, Paymob does not support the creation of a global account. You can only create an account for a specific region at this time.

#### How to Confirm Payment Status After Completion?

### Answer

Yes, after a successful payment attempt, Paymob triggers two types of callbacks:

**1\. Transaction Processed Callback (Server-to-Server)**

  - A **POST** request is sent to your backend endpoint. 

  - Includes key details such as transaction status (success or declined), order ID, transaction ID, and other relevant data. 

  - Used for securely updating your system with the final transaction result. 

**2\. Transaction Response Callback (Redirect)**

  - Redirects the customer back to your platform after payment. 

  - Includes query parameters that can be used to display a success or failure message. 

  - If you are using the mobile SDKs, this step is handled automatically.

Please check the details in the [**callback**](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/overview)section.

#### How can I configure custom callback URLs for each payment?

### Answer

You can define or override callback URLs directly in the [**intention creation request**](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention) using the following parameters:

  - `**notification_url**`: Used for the Transaction Processed Callback 

  - `**redirection_url**`: Used for the Transaction Response Callback

> **Warning:**
> 
> The`**redirection_url**` It is supported only with card and wallet payment methods.

#### How to Retrieve Details of a Specific Transaction?

### Answer

Paymob provides the ability to inquire about a specific transaction status using the **Transaction ID** , **Order ID** , or **Special Reference Number**. For detailed instructions on each method, please refer to the [**Transaction Inquiry API**](https://developers.paymob.com/paymob-docs/developers/transaction-inquiry-apis/by-transaction-id) section.

#### How to Retrieve the Subscription ID After Creation?

### Answer

There are two ways, please check them below:

  1. In the [**Subscription Callback**](https://developers.paymob.com/paymob-docs/developers/subscription/hmac-calculation-for-subscription-callback) returned after subscription creation.

  2. By [**Subscription Inquiry**](https://developers.paymob.com/paymob-docs/developers/subscription/subscription-actions/list-subscription-details) using the first 3DS transaction ID (The transaction that created the subscription).

#### Can I force saving the customer's card?

### Answer

Yes, this can be enabled using a dedicated Integration ID configured to enforce card saving.

To request this configuration, please contact your account manager or submit a support ticket at [**support@paymob.com**](https://mailto:support@paymob.com)
