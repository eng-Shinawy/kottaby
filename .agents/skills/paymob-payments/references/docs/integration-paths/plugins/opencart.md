---
title: "OpenCart"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/opencart
tab: documentation
breadcrumbs: "Integration Paths > Plugins > OpenCart"
---

# OpenCart
![](https://d24lr4zqs1tgqh.cloudfront.net/23458291-8b73-4e9f-99c4-6659858a6eda-696d49c90e7d4e9e101be737.svg)

**Who is this for -** Merchants and non-technical users who want to accept online payments on their OpenCart store without building a custom integration

**Outcome** : Explore, Install, and Configure **Paymob's OpenCart** plugin

### Overview

The Paymob **OpenCart** plugin enables you to accept online payments directly on your OpenCart store using Paymob’s secure payment gateway. It supports a smooth checkout experience.

### Installation Steps

###### 1

Download the Paymob OpenCart plugin from the provided [link](https://www.opencart.com/index.php?route=marketplace/extension/info&extension_id=45371)

###### 2

Log in to your **OpenCart admin panel** , then navigate to **Extensions ⇒** **Installer**. Click the **Upload** button at the top of the page and upload the plugin file.

![](https://d24lr4zqs1tgqh.cloudfront.net/e2ba813f-4b15-451d-a2d8-242bde88414f.jpg)

![](https://d24lr4zqs1tgqh.cloudfront.net/f50f2079-124d-43ab-85ec-acae1266d981.jpg)

###### 3

From the left sidebar menu, go to **Extensions ⇒** **Extensions**. Select **Payments** from the **Extension Type** dropdown, locate **Paymob** Payment, and click **Install**.

### Plugin Configuration

###### 1

After installation, click **Edit** next to **Paymob** Payment.

###### 2

Choose to **enable** or **disable** the plugin, then enter your Paymob integration details, including: • **Secret Key • Public Key • API key**

![](https://d24lr4zqs1tgqh.cloudfront.net/57b277ce-2886-4535-ba60-0b4bb4b6c4fb.jpg)

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 3

Click on the **Validate Paymob API key** button to ensure the data provided keys are valid and return the needed information.

###### 4

Select the integration IDs that you need the end-user pay with or see in the Paymob payment page.

###### 5

Copy the integration callback URL that exists in the Paymob OpenCart setting page. Then, paste it into each payment integration in the Paymob dashboard.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 6

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
