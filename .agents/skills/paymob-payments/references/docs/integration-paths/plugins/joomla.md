---
title: "Joomla"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/joomla
tab: documentation
breadcrumbs: "Integration Paths > Plugins > Joomla"
---

# Joomla
![](https://d24lr4zqs1tgqh.cloudfront.net/23458291-8b73-4e9f-99c4-6659858a6eda-696d49c90e7d4e9e101be737.svg)

**Who is this for -** For Joomla site owners and technical administrators who want to integrate Paymob payments into their website

**Outcome -** Explore, Install, and Configure Paymob's **Joomla** plugin

### Overview

The Paymob **Joomla** plugin allows you to accept online payments through a simple plugin-based setup, enabling card and supported alternative payment methods without custom development.

### Installation Steps

###### 1

Download the Paymob Joomla plugin from [**the marketplace**](https://extensions.joomla.org/extension/e-commerce/payment-gateway/paymob/)

###### 2

Log into admin panel of your **Joomla** store. Browse to your admin panel ⇒ **Extensions** ⇒ **Manage** ⇒ **Install**.

###### 3

Click on "**Browse for file** ", then choose our plugin `**.zip**` file in the plugin list.

![](https://d24lr4zqs1tgqh.cloudfront.net/8c16e09d-c9fc-435b-a774-c34cefd8fba0.jpg)

###### 4

Click on **VirtueMart ⇒** **Payment Methods**.

![](https://d24lr4zqs1tgqh.cloudfront.net/3dac6d78-0133-4942-bcca-7225f33aee74.jpg)

###### 5

Click on the "**New** " button. You will be redirected to the payment method information page.

![](https://d24lr4zqs1tgqh.cloudfront.net/358fd971-3547-46d5-a7d6-5515530cce1c.jpg)

###### 6

You will then fill in the payment method information based on which one you will integrate, then you will click "**Save** ", and then click on the "**Configuration** " tab.

![](https://d24lr4zqs1tgqh.cloudfront.net/268710ee-e797-4fb8-908f-1867a5a7b651.jpg)

### Plugin Configuration

###### 1

Paste each key in its place in the Paymob **Virtuemart Configuration** page.

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 2

Click on the**Validate API key** button to ensure the data provided keys are valid and return the needed information.

![](https://d24lr4zqs1tgqh.cloudfront.net/07b66a08-abb5-4543-ab91-69b32da86ef0.jpg)

###### 3

Select the **Integration IDs** that you want to enable for your customers during checkout.

###### 4

Copy the integration callback URL that exists in the Paymob **Virtuemart Configuration** page. Then, paste it into each payment integration in the Paymob account.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 5

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
