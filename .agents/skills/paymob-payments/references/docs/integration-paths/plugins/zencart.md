---
title: "ZenCart"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/zencart
tab: documentation
breadcrumbs: "Integration Paths > Plugins > ZenCart"
---

# ZenCart
![](https://d24lr4zqs1tgqh.cloudfront.net/23458291-8b73-4e9f-99c4-6659858a6eda-696d49c90e7d4e9e101be737.svg)

**Who is this for -** ZenCart store owners and administrators looking to add Paymob as a payment option without building a custom integration

**Outcome -** Explore, Install, and Configure Paymob's **ZenCart** plugin

### Overview

The Paymob **ZenCart** integration enables merchants to connect their store to Paymob’s payment gateway using a dedicated payment module, allowing customers to complete payments securely during checkout. 

### Installation Steps

###### 1

Download the Paymob PrestaShop module from this [**link**](https://gitlab.com/paymob-integrations/public-plugins/-/raw/main/unified%20checkout/OsCommerce/paymob_oscommerce.zip?ref_type=heads&inline=false).

###### 2

Extract the downloaded **ZenCart** module`**.zip**` file into your server in the path of the **ZenCart** project.

###### 3

Log in to the **ZenCart** admin panel, navigate to **Modules** → **Payment**.

###### 4

Search for **Paymob Payment** , then click on it and **install** the module.

![](https://d24lr4zqs1tgqh.cloudfront.net/a97a7244-f2e8-491d-8a93-1cf3787e15ad.jpg)

### Plugin Configuration

###### 1

In **Modules** ⇒ **Payment** ⇒ **Paymob Payment** (on the right side), paste each key in its place, select **Paymob payment** , paste each key in its place in the settings page

![](https://d24lr4zqs1tgqh.cloudfront.net/67182545-4ce4-47a6-a60f-7963d39738db.jpg)

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 2

Enter the**integration IDs** separated by a comma (**,**).

###### 3

Copy the integration **callback URL** that exists in the Paymob **ZenCart** Configuration page, then paste it into each payment integration in the Paymob account.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 4

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
